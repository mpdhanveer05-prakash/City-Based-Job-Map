"""Source checks for recorded evidence (ADR-0022): is the fact still on the page someone cited?

`evidence_due` lists the evidence behind each public record's current value whose field is due a check (jobs daily,
company facts weekly, office and funding facts monthly; table `evidence_refresh_policy`). Each is fetched once:

  * fetch_failed     the page could not be read (a network error, a refusal, any status other than 2xx). Nothing is
                     known about the value; it is NOT treated as a change.
  * value_found      (method `text`) the value is on the page.
  * value_not_found  (method `text`) the page was read and the value is not on it: a possible change, for a person to
                     confirm by recording new evidence. The pipeline never decides that a fact changed.
  * reachable        (method `reachable`) the page answered; a classification cannot be read off a page, so the value
                     is not judged.

A check never changes the evidence or its verified_at: only a person recording new evidence does.
"""
from __future__ import annotations

import html
import re
import unicodedata
from dataclasses import dataclass
from typing import Callable

from .fetch import FetchError, Response, request

Requester = Callable[[str], Response]

_TAGS = re.compile(r"<(script|style)\b.*?</\1>|<[^>]+>", re.IGNORECASE | re.DOTALL)
_SPACE = re.compile(r"\s+")


def page_text(body: str) -> str:
    """The visible text of an HTML page, unescaped, with white space collapsed and case folded."""
    text = html.unescape(_TAGS.sub(" ", body))
    return _SPACE.sub(" ", unicodedata.normalize("NFKC", text)).strip().casefold()


def normalise(value: str) -> str:
    return _SPACE.sub(" ", unicodedata.normalize("NFKC", value)).strip().casefold()


@dataclass(frozen=True)
class Outcome:
    outcome: str
    http_status: int | None
    note: str | None = None


def judge(method: str, value: str, response: Response | None, error: str | None = None) -> Outcome:
    """What one fetch says about one value. Pure, so the rules are unit-tested."""
    if response is None:
        return Outcome("fetch_failed", None, (error or "the request failed")[:500])
    if not 200 <= response.status < 300:
        return Outcome("fetch_failed", response.status, f"HTTP {response.status}")
    if method == "reachable":
        return Outcome("reachable", response.status)
    if normalise(value) and normalise(value) in page_text(response.body):
        return Outcome("value_found", response.status)
    return Outcome("value_not_found", response.status, "the page was read, but the value is not on it")


@dataclass
class EvidenceReport:
    checked: int = 0
    found: int = 0
    not_found: int = 0
    failed: int = 0
    reachable: int = 0


def run_evidence_checks(conn, *, limit: int = 200, requester: Requester = lambda u: request(u, "GET")) -> EvidenceReport:
    report = EvidenceReport()
    due = conn.execute("select evidence_id, field, value, source_url, method from evidence_due(%s)", (limit,)).fetchall()
    for row in due:
        try:
            outcome = judge(row["method"], row["value"], requester(row["source_url"]))
        except FetchError as e:
            outcome = judge(row["method"], row["value"], None, str(e))
        conn.execute("select record_evidence_check(%s, %s, %s, %s)", (row["evidence_id"], outcome.outcome, outcome.http_status, outcome.note))
        conn.commit()
        report.checked += 1
        if outcome.outcome == "value_found":
            report.found += 1
        elif outcome.outcome == "value_not_found":
            report.not_found += 1
        elif outcome.outcome == "fetch_failed":
            report.failed += 1
        else:
            report.reachable += 1
    return report
