"""Shared fixtures. The database tests need the DISPOSABLE test stack (`node scripts/test-stack.mts start --db-only`) and
TEST_DATABASE_URL pointing at it (postgresql://postgres:postgres@127.0.0.1:55322/postgres); without it they are skipped, so
`pytest` still runs everywhere. Any other database is refused, never used: the main local database holds the pilot drafts."""
import os

import psycopg
import pytest
from psycopg.rows import dict_row

DSN = os.environ.get("TEST_DATABASE_URL")
MAIN_DB_PORT = 54322


def refusal(port: int | None, marker: str | None, real_companies: int) -> str | None:
    """Why a database must not be used by these tests, or None for the disposable test stack (as tests/disposable-db.ts)."""
    if port == MAIN_DB_PORT:
        return f"port {MAIN_DB_PORT} is the main local database; start the test stack: node scripts/test-stack.mts start --db-only"
    if marker != "company-map-test":
        return "it has no test_stack.marker, so it is not the disposable test stack"
    if real_companies > 0:
        return f"it holds {real_companies} real (non-synthetic, non-.test) companies"
    return None


_checked = False


def _assert_disposable() -> None:
    global _checked
    if _checked:
        return
    with psycopg.connect(DSN) as conn:
        marker_present = conn.execute("select to_regclass('test_stack.marker') is not null").fetchone()[0]
        marker = conn.execute("select project_id from test_stack.marker limit 1").fetchone()[0] if marker_present else None
        real = conn.execute(
            "select count(*) from public.company where not is_synthetic and domain not like '%.test' and domain not like '%.example'"
        ).fetchone()[0]
    port = psycopg.conninfo.conninfo_to_dict(DSN).get("port")
    why = refusal(int(port) if port else None, marker, real)
    if why:
        pytest.exit(f"refusing TEST_DATABASE_URL: {why}", returncode=2)
    _checked = True


@pytest.fixture
def db():
    """A connection as the owner that is rolled back at the end. `commit` is turned off so the code under test, which commits
    after each feed, leaves nothing behind. Use `as_pipeline()` to run the next statements as the pipeline role."""
    if not DSN:
        pytest.skip("TEST_DATABASE_URL is not set")
    _assert_disposable()
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
        # Approved (ADR-0022): the pipeline reads approved feeds only. Recorded here as the owner, not through approve_job_feed.
        "insert into job_feed (company_id, source_id, provider, identifier, approved_by, approved_at, approval_note) values (%s, %s, 'greenhouse', 'pipeline-test', gen_random_uuid(), now(), 'test fixture') returning id",
        (company, source),
    ).fetchone()["id"]
    return {"source": source, "company": company, "city": city, "feed": feed}
