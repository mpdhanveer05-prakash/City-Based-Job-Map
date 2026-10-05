"""Parsers for the job feeds a company publishes (P8-01, docs/data-model.md "Pipeline").

Each parser takes the feed's response body and returns the jobs in it, or raises FeedError when the body is not what
that provider sends. A job with no title, no id, or no https link is skipped and counted. Nothing here fetches: the
fetcher (fetch.py) has the network rules, so these are plain functions over text and easy to test.

Providers (ATS public job-board APIs, which companies publish for exactly this use) and the JSON-LD a careers page
embeds as schema.org JobPosting.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from typing import Any, Callable

from .models import FeedError, FeedJob, ParseResult

PROVIDERS = ("greenhouse", "lever", "ashby", "workable", "jsonld")

_BOARD = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$")

#: The URL each API provider answers at. The identifier is checked against _BOARD, so it cannot change the host.
_ENDPOINTS: dict[str, str] = {
    "greenhouse": "https://boards-api.greenhouse.io/v1/boards/{id}/jobs",
    "lever": "https://api.lever.co/v0/postings/{id}?mode=json",
    "ashby": "https://api.ashbyhq.com/posting-api/job-board/{id}",
    "workable": "https://apply.workable.com/api/v1/widget/accounts/{id}",
}


def feed_url(provider: str, identifier: str) -> str:
    """The https URL of a provider's feed. For `jsonld` the identifier is the careers page URL itself."""
    if provider == "jsonld":
        return identifier
    if provider not in _ENDPOINTS:
        raise FeedError(f"unknown provider {provider!r}")
    if not _BOARD.match(identifier):
        raise FeedError(f"{identifier!r} is not a valid {provider} board name")
    return _ENDPOINTS[provider].format(id=identifier)


def _load(body: str) -> Any:
    try:
        return json.loads(body)
    except json.JSONDecodeError as error:
        raise FeedError(f"the feed is not JSON ({error.msg})") from error


def _https(url: Any) -> str | None:
    return url.strip() if isinstance(url, str) and url.strip().lower().startswith("https://") and len(url) < 2000 else None


def _text(value: Any, limit: int = 300) -> str:
    return re.sub(r"\s+", " ", value).strip()[:limit] if isinstance(value, str) else ""


def _date(value: Any) -> date | None:
    if isinstance(value, (int, float)) and value > 0:
        # Milliseconds since the epoch (Lever).
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).date()
    if isinstance(value, str) and re.match(r"^\d{4}-\d{2}-\d{2}", value):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _work_mode(text: str) -> str | None:
    t = text.lower()
    if "hybrid" in t:
        return "hybrid"
    if "remote" in t or "telecommute" in t:
        return "remote"
    if "on-site" in t or "onsite" in t or "on site" in t:
        return "onsite"
    return None


def _build(items: list[dict[str, Any]], make: Callable[[dict[str, Any]], FeedJob | None]) -> ParseResult:
    jobs: list[FeedJob] = []
    seen: set[str] = set()
    skipped = 0
    for item in items:
        job = make(item) if isinstance(item, dict) else None
        if job is None or job.external_ref in seen:
            skipped += 1
            continue
        seen.add(job.external_ref)
        jobs.append(job)
    return ParseResult(jobs=jobs, skipped=skipped)


def parse_greenhouse(body: str) -> ParseResult:
    data = _load(body)
    if not isinstance(data, dict) or not isinstance(data.get("jobs"), list):
        raise FeedError("a Greenhouse feed has a `jobs` list")

    def make(j: dict[str, Any]) -> FeedJob | None:
        ref, title, url = j.get("id"), _text(j.get("title")), _https(j.get("absolute_url"))
        if ref is None or not title or not url:
            return None
        location = _text((j.get("location") or {}).get("name") if isinstance(j.get("location"), dict) else "")
        return FeedJob(str(ref), title, url, location, remote="remote" in location.lower(), work_mode=_work_mode(location), posted_at=_date(j.get("updated_at")))

    return _build(data["jobs"], make)


def parse_lever(body: str) -> ParseResult:
    data = _load(body)
    if not isinstance(data, list):
        raise FeedError("a Lever feed is a list of postings")

    def make(j: dict[str, Any]) -> FeedJob | None:
        ref, title, url = j.get("id"), _text(j.get("text")), _https(j.get("hostedUrl"))
        if not ref or not title or not url:
            return None
        categories = j.get("categories") if isinstance(j.get("categories"), dict) else {}
        location = _text(categories.get("location"))
        workplace = _text(j.get("workplaceType"))
        return FeedJob(str(ref), title, url, location, remote=workplace.lower() == "remote", work_mode=_work_mode(workplace or location), posted_at=_date(j.get("createdAt")))

    return _build(data, make)


def parse_ashby(body: str) -> ParseResult:
    data = _load(body)
    if not isinstance(data, dict) or not isinstance(data.get("jobs"), list):
        raise FeedError("an Ashby feed has a `jobs` list")

    def make(j: dict[str, Any]) -> FeedJob | None:
        ref, title, url = j.get("id"), _text(j.get("title")), _https(j.get("jobUrl"))
        if not ref or not title or not url:
            return None
        location = _text(j.get("location"))
        remote = bool(j.get("isRemote"))
        return FeedJob(str(ref), title, url, location, remote=remote, work_mode="remote" if remote else _work_mode(location), posted_at=_date(j.get("publishedAt")))

    return _build(data["jobs"], make)


def parse_workable(body: str) -> ParseResult:
    data = _load(body)
    if not isinstance(data, dict) or not isinstance(data.get("jobs"), list):
        raise FeedError("a Workable feed has a `jobs` list")

    def make(j: dict[str, Any]) -> FeedJob | None:
        ref, title, url = j.get("shortcode"), _text(j.get("title")), _https(j.get("url"))
        if not ref or not title or not url:
            return None
        location = ", ".join(p for p in (_text(j.get("city")), _text(j.get("country"))) if p)
        remote = bool(j.get("telecommuting"))
        return FeedJob(str(ref), title, url, location, remote=remote, work_mode="remote" if remote else None, posted_at=_date(j.get("published_on")))

    return _build(data["jobs"], make)


class _JsonLdBlocks(HTMLParser):
    """Collects the text of every <script type="application/ld+json"> block."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[str] = []
        self._in = False
        self._buf: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "script" and any(k == "type" and (v or "").lower().split(";")[0].strip() == "application/ld+json" for k, v in attrs):
            self._in, self._buf = True, []

    def handle_data(self, data: str) -> None:
        if self._in:
            self._buf.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._in:
            self.blocks.append("".join(self._buf))
            self._in = False


def _postings(node: Any) -> list[dict[str, Any]]:
    """Every JobPosting in a JSON-LD value: a single object, a list, or a @graph."""
    found: list[dict[str, Any]] = []
    if isinstance(node, list):
        for item in node:
            found.extend(_postings(item))
    elif isinstance(node, dict):
        kind = node.get("@type")
        kinds = kind if isinstance(kind, list) else [kind]
        if "JobPosting" in kinds:
            found.append(node)
        found.extend(_postings(node.get("@graph")))
    return found


def parse_jsonld(body: str) -> ParseResult:
    """schema.org JobPosting blocks in a careers page. The link is `url`, else `sameAs`; the id is `identifier` or the link."""
    collector = _JsonLdBlocks()
    collector.feed(body)
    items: list[dict[str, Any]] = []
    for block in collector.blocks:
        try:
            items.extend(_postings(json.loads(block)))
        except json.JSONDecodeError:
            continue  # one broken block on a page does not discard the others

    def make(j: dict[str, Any]) -> FeedJob | None:
        title = _text(j.get("title"))
        url = _https(j.get("url")) or _https(j.get("sameAs"))
        identifier = j.get("identifier")
        ref = identifier.get("value") if isinstance(identifier, dict) else identifier
        ref = str(ref).strip() if isinstance(ref, (str, int)) and str(ref).strip() else url
        if not title or not url or not ref:
            return None
        loc = j.get("jobLocation")
        loc = loc[0] if isinstance(loc, list) and loc else loc
        address = loc.get("address") if isinstance(loc, dict) else None
        location = ", ".join(p for p in (_text(address.get("addressLocality")), _text(address.get("addressRegion"))) if p) if isinstance(address, dict) else ""
        remote = _text(j.get("jobLocationType")).upper() == "TELECOMMUTE"
        return FeedJob(str(ref), title, url, location, remote=remote, work_mode="remote" if remote else None, posted_at=_date(j.get("datePosted")))

    return _build(items, make)


PARSERS: dict[str, Callable[[str], ParseResult]] = {
    "greenhouse": parse_greenhouse,
    "lever": parse_lever,
    "ashby": parse_ashby,
    "workable": parse_workable,
    "jsonld": parse_jsonld,
}


def parse(provider: str, body: str) -> ParseResult:
    try:
        parser = PARSERS[provider]
    except KeyError as error:
        raise FeedError(f"unknown provider {provider!r}") from error
    return parser(body)
