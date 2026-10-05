"""The feed sync (P8-01): for every active feed, fetch, parse, plan, write, and say what happened.

A feed that cannot be fetched or parsed is reported and changes nothing (a broken fetch must never expire jobs). A run
beats its heartbeat only when at least one feed worked, so a night of total failure is noticed by the monitor.
"""
from __future__ import annotations

import urllib.parse
from dataclasses import dataclass, field
from typing import Callable

from . import repo
from .feeds import feed_url, parse
from .fetch import FetchError, fetch_text
from .links import acceptable_apply_link, company_owns
from .models import FeedError
from .plan import cities_for, plan_sync

Fetcher = Callable[[str], str]


@dataclass
class FeedReport:
    feed_id: int
    company: str
    provider: str
    status: str  # ok, partial, failed
    detail: str
    counts: dict[str, int] = field(default_factory=dict)


def sync_feed(conn, feed: repo.FeedConfig, fetcher: Fetcher = fetch_text) -> FeedReport:
    base = FeedReport(feed.id, feed.company_slug, feed.provider, "failed", "")
    try:
        url = feed_url(feed.provider, feed.identifier)
        if feed.provider == "jsonld" and not company_owns(url, feed.company_domain):
            raise FeedError(f"the careers page {urllib.parse.urlsplit(url).hostname} is not on the company's domain {feed.company_domain}")
        parsed = parse(feed.provider, fetcher(url))
    except (FetchError, FeedError) as error:
        base.detail = str(error)
        repo.mark_source(conn, feed.source_id, "failed", f"{feed.company_slug}/{feed.provider}: {error}")
        conn.commit()
        return base

    # A link the site would refuse at build time (docs/security.md) never gets in: the build would fail on it.
    usable = [j for j in parsed.jobs if acceptable_apply_link(j.apply_url, feed.company_domain)]
    parsed_skipped = parsed.skipped + (len(parsed.jobs) - len(usable))

    cities = repo.company_cities(conn, feed.company_id)
    names = {slug: names for slug, (_, names) in cities.items()}
    plan = plan_sync(repo.existing_jobs(conn, feed.company_id, feed.source_id), usable)
    if plan.guarded:
        base.status, base.detail = "partial", plan.guarded
        repo.mark_source(conn, feed.source_id, "partial", f"{feed.company_slug}/{feed.provider}: {plan.guarded}")
        conn.commit()
        return base

    done = repo.apply_plan(conn, feed, plan, lambda job: cities_for(job, names), cities)
    done["skipped_in_feed"] = parsed_skipped
    detail = ", ".join(f"{k} {v}" for k, v in done.items() if v)
    status = "partial" if parsed_skipped else "ok"
    repo.mark_source(conn, feed.source_id, status, f"{feed.company_slug}/{feed.provider}: {detail or 'no changes'}")
    conn.commit()
    return FeedReport(feed.id, feed.company_slug, feed.provider, status, detail or "no changes", done)


def run_sync(conn, fetcher: Fetcher = fetch_text) -> list[FeedReport]:
    reports = [sync_feed(conn, feed, fetcher) for feed in repo.load_feeds(conn)]
    worked = [r for r in reports if r.status != "failed"]
    if reports and not worked:
        # Every feed failed: leave the heartbeat alone so the monitor sees a missed run.
        return reports
    repo.heartbeat(conn, "feed-sync", f"{len(worked)} of {len(reports)} feeds worked")
    conn.commit()
    return reports
