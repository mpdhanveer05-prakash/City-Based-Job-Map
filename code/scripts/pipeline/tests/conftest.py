"""Shared fixtures. The database tests need a local Postgres with the migrations applied (`npx supabase db start`, then
`db reset`) and LOCAL_DATABASE_URL pointing at it; without it they are skipped, so `pytest` still runs everywhere."""
import os

import psycopg
import pytest
from psycopg.rows import dict_row

DSN = os.environ.get("LOCAL_DATABASE_URL")


@pytest.fixture
def db():
    """A connection as the owner that is rolled back at the end. `commit` is turned off so the code under test, which commits
    after each feed, leaves nothing behind. Use `as_pipeline()` to run the next statements as the pipeline role."""
    if not DSN:
        pytest.skip("LOCAL_DATABASE_URL is not set")
    conn = psycopg.connect(DSN, row_factory=dict_row)
    conn.commit = lambda: None  # type: ignore[method-assign]
    # The test login may switch to the pipeline role (Postgres 16 and later: the creator of a role does not get SET on it by
    # default). It is part of the transaction, so the rollback undoes it.
    conn.execute("grant pipeline to current_user with set true")
    try:
        yield conn
    finally:
        conn.rollback()
        conn.close()


def as_pipeline(conn):
    conn.execute("set role pipeline")


def as_owner(conn):
    conn.execute("reset role")


@pytest.fixture
def world(db):
    """A published company with an office in Bengaluru, a Greenhouse feed for it, and the ids the tests need."""
    source = db.execute("insert into source (name, kind, permission_note) values ('Pipeline test feed', 'ats_feed', 'test') returning id").fetchone()["id"]
    company = db.execute(
        """insert into company (slug, name, domain, website_url, status, source_id)
           values ('pipeline-test-co', 'Pipeline Test Co', 'pipeline-test.example', 'https://pipeline-test.example', 'published', %s) returning id::text as id""",
        (source,),
    ).fetchone()["id"]
    city = db.execute("select id from city where slug = 'bangalore'").fetchone()["id"]
    db.execute(
        """insert into office (company_id, city_id, address, geom, accuracy, status)
           values (%s, %s, 'Test office', 'SRID=4326;POINT(77.60 12.97)', 'building', 'published')""",
        (company, city),
    )
    feed = db.execute(
        "insert into job_feed (company_id, source_id, provider, identifier) values (%s, %s, 'greenhouse', 'pipeline-test') returning id",
        (company, source),
    ).fetchone()["id"]
    return {"source": source, "company": company, "city": city, "feed": feed}
