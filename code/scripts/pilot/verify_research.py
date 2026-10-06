"""Bengaluru pilot (6 Oct 2026): checks every piece of researched evidence against the page it cites, before anything is
imported. Run from code/: python -m scripts.pilot.verify_research

The research (data/pilot/bangalore/research/*.json) was gathered by AI agents through a summarising web fetch, so a
quote is NOT trusted until this script finds it in the raw text of the cited page, fetched again here. Rules:

  * every fact needs its own evidence: a URL on the company's own domain and a quote found on that page;
  * the name must also appear on that page (a quote that does not contain the name does not support the name);
  * the website is supported only by a page served from that website's domain;
  * ownership "public" needs a quote naming an exchange (NYSE, NASDAQ, NSE, BSE);
  * the full address (not only its quote) must be on the page, since that is the text visitors see;
  * a fact whose quote is not found is dropped (left unknown), never kept on trust;
  * a company is a pilot candidate only when its name, website, and a Bengaluru address all verify.

verified_at is today's date only for evidence this script actually confirmed today. Nothing is reviewed or published.
Output: data/pilot/bangalore/verification.json (every check, with its outcome) and candidates.json (what may be imported).
"""
from __future__ import annotations

import datetime as dt
import json
import re
import time
import unicodedata
import urllib.parse
from pathlib import Path

from scripts.pipeline.evidence import page_text
from scripts.pipeline.fetch import FetchError, request

ROOT = Path(__file__).resolve().parents[2] / "data" / "pilot" / "bangalore"
FIELDS = ["name", "website", "address", "description", "types", "sectors", "ownership_status"]
EXCHANGES = re.compile(r"\b(nyse|nasdaq|nse|bse|national stock exchange|bombay stock exchange)\b", re.I)
BENGALURU = re.compile(r"\b(bengaluru|bangalore)\b", re.I)

# Typographic variants a summariser or a page may use: compare them as one.
_FOLD = str.maketrans({"–": "-", "—": "-", "‒": "-", "−": "-", "‘": "'", "’": "'", "“": '"', "”": '"', " ": " ", " ": " "})


def fold(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).translate(_FOLD).casefold()
    return re.sub(r"\s+", " ", text).strip()


def host(url: str) -> str:
    return (urllib.parse.urlsplit(url).hostname or "").lower().removeprefix("www.")


def on_domain(url: str, domain: str) -> bool:
    h, d = host(url), domain.lower().removeprefix("www.")
    return h == d or h.endswith("." + d)


_cache: dict[str, tuple[str | None, str | None]] = {}


def fetch(url: str) -> tuple[str | None, str | None]:
    """(folded page text, error)."""
    if url in _cache:
        return _cache[url]
    try:
        response = request(url, "GET")
        result = (fold(page_text(response.body)), None) if 200 <= response.status < 300 else (None, f"HTTP {response.status}")
    except FetchError as e:
        result = (None, str(e))
    except Exception as e:  # noqa: BLE001 - any network failure is "could not be read", never a pass
        result = (None, f"{type(e).__name__}: {e}")
    _cache[url] = result
    time.sleep(0.5)
    return result


def check(company: dict, field: str) -> dict:
    ev = (company.get("evidence") or {}).get(field)
    value = company.get(field) if field != "website" else company.get("website_url")
    if field in ("types", "sectors") and not value:
        return {"field": field, "outcome": "empty"}
    if value in (None, "", []):
        return {"field": field, "outcome": "empty"}
    if not ev or not ev.get("url") or not ev.get("quote"):
        return {"field": field, "outcome": "no_evidence"}
    url, quote = ev["url"], ev["quote"]
    domain = company.get("domain") or ""
    out = {"field": field, "url": url, "quote": quote}
    if not url.startswith("https://") or not domain or not on_domain(url, domain):
        return {**out, "outcome": "not_official", "detail": f"{host(url)} is not on {domain or 'an unknown domain'}"}
    text, error = fetch(url)
    if text is None:
        return {**out, "outcome": "fetch_failed", "detail": error}
    if fold(quote) not in text:
        return {**out, "outcome": "quote_not_found"}
    if field == "name" and fold(company["name"]) not in text:
        return {**out, "outcome": "name_not_on_page"}
    if field == "address" and not BENGALURU.search(company["address"]):
        return {**out, "outcome": "not_bengaluru"}
    if field == "address" and fold(company["address"]) not in text:
        # The address shown to visitors is the full text, so the full text must be on the page, not just the quote.
        return {**out, "outcome": "full_address_not_on_page"}
    if field == "ownership_status" and (value != "public" or not EXCHANGES.search(quote)):
        return {**out, "outcome": "no_exchange_named"}
    return {**out, "outcome": "verified"}


def main() -> None:
    today = dt.date.today().isoformat()
    report, candidates = [], []
    for path in sorted((ROOT / "research").glob("group-*.json"), key=lambda p: (p.stem.startswith("group-r"), p.stem)):
        for company in json.loads(path.read_text(encoding="utf-8")):
            checks = [check(company, f) for f in FIELDS]
            by = {c["field"]: c for c in checks}
            report.append({"candidate": company["candidate"], "group": path.stem, "checks": checks, "uncertain": company.get("uncertain")})
            core = all(by[f]["outcome"] == "verified" for f in ("name", "website", "address"))
            if not core:
                continue
            record = {
                "name": company["name"],
                "domain": company["domain"],
                "website_url": company["website_url"],
                "address": company["address"],
                "verified_at": today,
                "evidence": {f: {"url": by[f]["url"], "quote": by[f]["quote"]} for f in FIELDS if by[f]["outcome"] == "verified"},
                "dropped": {f: by[f]["outcome"] for f in FIELDS if by[f]["outcome"] not in ("verified", "empty")},
                "research_note": company.get("uncertain"),
            }
            for f in ("description", "types", "sectors", "ownership_status"):
                record[f] = company.get(f) if by[f]["outcome"] == "verified" else (None if f in ("description", "ownership_status") else [])
            candidates.append(record)
    # One candidate per company: a later research round replaces an earlier one only by passing the same checks.
    by_domain: dict[str, dict] = {}
    for c in candidates:
        by_domain[c["domain"].lower().removeprefix("www.")] = c
    candidates = sorted(by_domain.values(), key=lambda c: c["name"].lower())
    (ROOT / "verification.json").write_text(json.dumps({"checked_on": today, "companies": report}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (ROOT / "candidates.json").write_text(json.dumps({"checked_on": today, "candidates": candidates}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    counts: dict[str, int] = {}
    for r in report:
        for c in r["checks"]:
            counts[c["outcome"]] = counts.get(c["outcome"], 0) + 1
    print(f"researched {len(report)} companies; {len(candidates)} have a verified name, website, and Bengaluru address")
    print("evidence outcomes:", json.dumps(counts, sort_keys=True))


if __name__ == "__main__":
    main()
