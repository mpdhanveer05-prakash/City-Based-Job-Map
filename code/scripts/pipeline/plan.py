"""Deciding what a feed run changes (P8-01), without touching the database, so the rules are testable.

Rules (docs/data-model.md "Pipeline", architecture plan JOB05):
  * a job in the feed and in the database is refreshed and made active again (a returning job comes back);
  * a job in the feed and not in the database is inserted, active (a trusted ATS feed publishes at once);
  * a live job (active or suspect) missing from the feed is suspect the first time and expired the second: two checks,
    so one odd response never hides a job that is still open;
  * an EMPTY feed when the company has live jobs is not believed: nothing changes and the run says so (a provider error
    or a changed page often looks like "no jobs").
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

from .models import FeedJob


def title_norm(title: str) -> str:
    """Lower-cased with the ends trimmed: the same as the SQL `lower(btrim(title))`."""
    return title.strip().lower()


def dedup_hash(company_id: str, title: str, apply_url: str) -> bytes:
    """The same as the job_defaults trigger: md5 of company id, normalised title, and link, joined by a bar."""
    return hashlib.md5(f"{company_id}|{title_norm(title)}|{apply_url}".encode()).digest()


@dataclass(frozen=True)
class ExistingJob:
    id: str
    external_ref: str | None
    title: str
    apply_url: str
    status: str
    consecutive_failures: int = 0


@dataclass
class Plan:
    inserts: list[FeedJob] = field(default_factory=list)
    refresh: list[tuple[ExistingJob, FeedJob]] = field(default_factory=list)
    suspect: list[ExistingJob] = field(default_factory=list)
    expire: list[ExistingJob] = field(default_factory=list)
    #: Set when the feed was refused as an empty answer: the run changes nothing.
    guarded: str | None = None

    def counts(self) -> dict[str, int]:
        return {"new": len(self.inserts), "refreshed": len(self.refresh), "suspect": len(self.suspect), "expired": len(self.expire)}


LIVE = ("active", "suspect")


def plan_sync(existing: list[ExistingJob], feed: list[FeedJob]) -> Plan:
    plan = Plan()
    by_ref = {j.external_ref: j for j in existing if j.external_ref}
    live = [j for j in existing if j.status in LIVE and j.external_ref]

    if not feed and live:
        plan.guarded = f"the feed has no jobs but {len(live)} are listed; not believed, nothing changed"
        return plan

    in_feed = {j.external_ref for j in feed}
    for job in feed:
        known = by_ref.get(job.external_ref)
        if known is None:
            plan.inserts.append(job)
        else:
            plan.refresh.append((known, job))
    for job in live:
        if job.external_ref in in_feed:
            continue
        (plan.expire if job.status == "suspect" else plan.suspect).append(job)
    return plan


def cities_for(job: FeedJob, office_cities: dict[str, list[str]]) -> list[str]:
    """The cities (by slug) that should list the job. `office_cities` maps a slug to the names and aliases that mean it,
    for the cities where the company has an office.

    A job is listed in a city when its location text names the city. A remote job, or one with no location, is listed in
    every city where the company has an office (the visitor looking at that city can apply). A job located somewhere
    else is listed nowhere (the launch cities only)."""
    text = job.location.lower()
    if text:
        named = [slug for slug, names in office_cities.items() if any(re.search(rf"\b{re.escape(n.lower())}\b", text) for n in names)]
        if named:
            return sorted(named)
    if job.remote or not text:
        return sorted(office_cities)
    return []
