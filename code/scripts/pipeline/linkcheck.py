"""The link checker (P8-02, JOB05, ADM05): is an Apply link still alive?

A job is judged by one request to its apply link (a HEAD, then a GET if the server refuses HEAD):
  * 200 to 299: alive, unless it was sent to the company's general careers index, which means "this job is gone";
  * 404 or 410: gone;
  * anything else (403, 429, a 5xx, a timeout, too many redirects): inconclusive. Nothing is recorded against the
    job, because a flaky server must not hide a live job. It is checked again next run.
Only a conclusive answer goes to `record_link_check`, which applies the two-strike rule in the database: a first failure
makes the job suspect and a second one expires it.
"""
from __future__ import annotations

import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Callable

from . import repo
from .fetch import FetchError, Response, request

#: Paths that are a company's list of jobs, not one job. Landing on one after asking for a specific posting means "gone".
GENERIC_INDEX_PATHS = {"", "/", "/careers", "/careers/", "/jobs", "/jobs/", "/careers/jobs", "/open-positions", "/join-us", "/work-with-us"}

Requester = Callable[[str, str], Response]


@dataclass(frozen=True)
class Verdict:
    #: True alive, False gone, None inconclusive.
    ok: bool | None
    status: int | None
    final_url: str | None
    note: str


def classify(requested: str, response: Response) -> Verdict:
    status, final = response.status, response.final_url
    if status in (404, 410):
        return Verdict(False, status, final, f"HTTP {status}")
    if 200 <= status < 300:
        requested_path = urllib.parse.urlsplit(requested).path.rstrip("/").lower()
        final_path = urllib.parse.urlsplit(final).path.rstrip("/").lower()
        if final_path in GENERIC_INDEX_PATHS and requested_path not in GENERIC_INDEX_PATHS and requested_path != final_path:
            return Verdict(False, status, final, "redirected to the careers index")
        return Verdict(True, status, final, "")
    return Verdict(None, status, final, f"HTTP {status}: inconclusive")


def check_link(url: str, requester: Requester = lambda u, m: request(u, m)) -> Verdict:
    try:
        response = requester(url, "HEAD")
        if response.status in (403, 405, 501):
            response = requester(url, "GET")
        return classify(url, response)
    except FetchError as error:
        return Verdict(None, None, None, f"{error}: inconclusive")


@dataclass
class CheckReport:
    checked: int = 0
    alive: int = 0
    gone: int = 0
    inconclusive: int = 0
    expired: int = 0
    suspect: int = 0


def run_checks(conn, *, limit: int = 500, workers: int = 8, requester: Requester = lambda u, m: request(u, m)) -> CheckReport:
    """Checks the jobs that have waited longest. The requests run in threads; the database is written by this thread only."""
    jobs = repo.jobs_to_check(conn, limit)
    report = CheckReport()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        verdicts = list(pool.map(lambda job: check_link(job["apply_url"], requester), jobs))
    for job, verdict in zip(jobs, verdicts):
        report.checked += 1
        if verdict.ok is None:
            report.inconclusive += 1
            continue
        status = repo.record_check(conn, job["id"], verdict.ok, verdict.status, verdict.final_url, verdict.note or None)
        if verdict.ok:
            report.alive += 1
        else:
            report.gone += 1
            if status == "expired":
                report.expired += 1
            elif status == "suspect":
                report.suspect += 1
        conn.commit()
    # A run that checked links is a run that worked, even if every link was inconclusive; a run that checked nothing
    # because there was nothing to check is also fine.
    repo.heartbeat(conn, "link-check", f"{report.checked} checked, {report.alive} alive, {report.gone} gone, {report.inconclusive} inconclusive")
    conn.commit()
    return report
