"""The pipeline's database access (P8-01, P8-02): plain SQL through psycopg, as the `pipeline` role.

The role can read the curated tables, write jobs and their city links, add link-check rows, update a source's last-run
columns, and touch heartbeats. It cannot change a company, an office, or an admin account. Row-level security applies
to it like to anyone (docs/security.md).
"""
from __future__ import annotations

import os
from dataclasses import dataclass

import psycopg
from psycopg.rows import dict_row

from .models import FeedJob
from .plan import ExistingJob, Plan


@dataclass(frozen=True)
class FeedConfig:
    id: int
    company_id: str
    company_slug: str
    company_domain: str
    source_id: int
    provider: str
    identifier: str


def connect(dsn: str | None = None) -> psycopg.Connection:
    """A connection with dict rows. The DSN is PIPELINE_DATABASE_URL by default; it is never printed."""
    url = dsn or os.environ.get("PIPELINE_DATABASE_URL")
    if not url or url.startswith("replace"):
        raise RuntimeError("PIPELINE_DATABASE_URL is not set")
    return psycopg.connect(url, row_factory=dict_row, application_name="company-map-pipeline")


def load_feeds(conn: psycopg.Connection) -> list[FeedConfig]:
    rows = conn.execute(
        """
        select f.id, f.company_id::text as company_id, c.slug as company_slug, c.domain as company_domain,
               f.source_id, f.provider, f.identifier
        from job_feed f join company c on c.id = f.company_id
        where f.active and c.status = 'published'
        order by f.id
        """
    ).fetchall()
    return [FeedConfig(**r) for r in rows]


def company_cities(conn: psycopg.Connection, company_id: str) -> dict[str, tuple[int, list[str]]]:
    """The cities where the company has a published office: slug -> (id, names that mean it)."""
    rows = conn.execute(
        """
        select distinct ci.id, ci.slug, ci.name, ci.aliases
        from office o join city ci on ci.id = o.city_id
        where o.company_id = %s and o.status = 'published'
        """,
        (company_id,),
    ).fetchall()
    return {r["slug"]: (r["id"], [r["name"], r["slug"], *r["aliases"]]) for r in rows}


def existing_jobs(conn: psycopg.Connection, company_id: str, source_id: int) -> list[ExistingJob]:
    rows = conn.execute(
        "select id::text as id, external_ref, title, apply_url, status, consecutive_failures from job where company_id = %s and source_id = %s",
        (company_id, source_id),
    ).fetchall()
    return [ExistingJob(**r) for r in rows]


def apply_plan(conn: psycopg.Connection, feed: FeedConfig, plan: Plan, cities_for_job, cities: dict[str, tuple[int, list[str]]]) -> dict[str, int]:
    """Writes the plan. Each row is its own savepoint, so one that collides (the same title and link already exists under
    another source) is counted and skipped without losing the rest. `cities_for_job(FeedJob) -> list[slug]`."""
    done = {"new": 0, "refreshed": 0, "suspect": 0, "expired": 0, "duplicates": 0, "unlisted": 0}

    def set_cities(job_id: str, job: FeedJob) -> bool:
        slugs = [s for s in cities_for_job(job) if s in cities]
        ids = [cities[s][0] for s in slugs]
        conn.execute("delete from job_city where job_id = %s and not (city_id = any(%s))", (job_id, ids))
        for city_id in ids:
            conn.execute("insert into job_city (job_id, city_id) values (%s, %s) on conflict do nothing", (job_id, city_id))
        return bool(ids)

    for job in plan.inserts:
        slugs = [s for s in cities_for_job(job) if s in cities]
        if not slugs:
            done["unlisted"] += 1  # a job located outside the launch cities is not stored
            continue
        try:
            with conn.transaction():
                row = conn.execute(
                    """
                    insert into job (company_id, source_id, external_ref, title, apply_url, status, work_mode, posted_at, last_checked_at, last_ok_at)
                    values (%s, %s, %s, %s, %s, 'active', %s, %s, now(), now())
                    on conflict (company_id, dedup_hash) do nothing
                    returning id::text as id
                    """,
                    (feed.company_id, feed.source_id, job.external_ref, job.title, job.apply_url, job.work_mode, job.posted_at),
                ).fetchone()
                if row is None:
                    done["duplicates"] += 1
                    continue
                set_cities(row["id"], job)
                done["new"] += 1
        except psycopg.errors.CheckViolation:
            done["unlisted"] += 1

    for known, job in plan.refresh:
        try:
            with conn.transaction():
                conn.execute(
                    """
                    update job set title = %s, apply_url = %s, status = 'active', consecutive_failures = 0,
                                   work_mode = coalesce(%s, work_mode), posted_at = coalesce(posted_at, %s),
                                   last_checked_at = now(), last_ok_at = now()
                    where id = %s
                    """,
                    (job.title, job.apply_url, job.work_mode, job.posted_at, known.id),
                )
                set_cities(known.id, job)
                done["refreshed"] += 1
        except psycopg.errors.UniqueViolation:
            done["duplicates"] += 1

    for known in plan.suspect:
        conn.execute("update job set status = 'suspect', consecutive_failures = greatest(consecutive_failures, 1), last_checked_at = now() where id = %s", (known.id,))
        done["suspect"] += 1
    for known in plan.expire:
        conn.execute("update job set status = 'expired', consecutive_failures = 2, last_checked_at = now() where id = %s", (known.id,))
        done["expired"] += 1
    return done


def mark_source(conn: psycopg.Connection, source_id: int, status: str, detail: str) -> None:
    conn.execute("update source set last_run_at = now(), last_run_status = %s, last_run_detail = %s where id = %s", (status, detail[:500], source_id))


def heartbeat(conn: psycopg.Connection, name: str, detail: str) -> None:
    conn.execute("select record_heartbeat(%s, %s)", (name, detail))


def missed_heartbeats(conn: psycopg.Connection) -> list[dict]:
    return list(conn.execute("select name, last_ok_at, expected_every, overdue from missed_heartbeats()").fetchall())


def jobs_to_check(conn: psycopg.Connection, limit: int) -> list[dict]:
    return list(
        conn.execute(
            "select id::text as id, apply_url from job where status in ('active', 'suspect') order by last_checked_at nulls first, id limit %s",
            (limit,),
        ).fetchall()
    )


def record_check(conn: psycopg.Connection, job_id: str, ok: bool, status: int | None, final_url: str | None, note: str | None) -> str:
    return conn.execute("select record_link_check(%s, %s, %s, %s, %s) as status", (job_id, ok, status, final_url, note)).fetchone()["status"]
