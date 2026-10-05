"""The pipeline against a real database, as the `pipeline` role (P8-01 to P8-03). Needs LOCAL_DATABASE_URL."""
import json

import psycopg
import pytest

from scripts.pipeline import repo
from scripts.pipeline.cli import monitor
from scripts.pipeline.fetch import FetchError, Response
from scripts.pipeline.linkcheck import run_checks
from scripts.pipeline.sync import run_sync, sync_feed

from .conftest import as_owner, as_pipeline

FEED_URL = "https://boards-api.greenhouse.io/v1/boards/pipeline-test/jobs"


def greenhouse(*jobs):
    return json.dumps({"jobs": [
        {"id": ref, "title": title, "absolute_url": url or f"https://pipeline-test.example/jobs/{ref}", "location": {"name": location}}
        for ref, title, location, url in jobs
    ]})


def fetcher(body):
    def fetch(url):
        assert url == FEED_URL
        if isinstance(body, Exception):
            raise body
        return body
    return fetch


def feed_config(db, world):
    as_pipeline(db)
    (feed,) = repo.load_feeds(db)
    return feed


def statuses(db):
    as_owner(db)
    rows = db.execute("select external_ref, status, consecutive_failures from job where external_ref is not null and company_id::text in (select company_id::text from job_feed where identifier = 'pipeline-test') order by external_ref").fetchall()
    return {r["external_ref"]: (r["status"], r["consecutive_failures"]) for r in rows}


def test_a_sync_inserts_jobs_lists_them_in_the_right_cities_and_beats_the_heartbeat(db, world):
    feed = feed_config(db, world)
    body = greenhouse(("a1", "Backend Engineer", "Bengaluru, India", None), ("a2", "Remote Writer", "Remote", None), ("a3", "Pune Analyst", "Pune", None))
    report = sync_feed(db, feed, fetcher(body))
    assert report.status == "ok"
    assert report.counts["new"] == 2 and report.counts["unlisted"] == 1
    as_owner(db)
    assert statuses(db) == {"a1": ("active", 0), "a2": ("active", 0)}
    cities = db.execute("select j.external_ref, count(*) as n from job j join job_city jc on jc.job_id = j.id where j.external_ref in ('a1','a2') group by 1 order by 1").fetchall()
    assert [(c["external_ref"], c["n"]) for c in cities] == [("a1", 1), ("a2", 1)]  # the company has an office in Bengaluru only
    assert db.execute("select last_run_status from source where id = %s", (world["source"],)).fetchone()["last_run_status"] == "ok"
    as_pipeline(db)
    run_sync(db, fetcher(body))
    as_owner(db)
    assert db.execute("select last_ok_at is not null as beat from heartbeat where name = 'feed-sync'").fetchone()["beat"]


def test_a_job_missing_twice_expires_and_one_that_returns_is_active_again(db, world):
    feed = feed_config(db, world)
    full = greenhouse(("a1", "Backend Engineer", "Bengaluru", None), ("a2", "Designer", "Bengaluru", None))
    only_a1 = greenhouse(("a1", "Backend Engineer", "Bengaluru", None))
    sync_feed(db, feed, fetcher(full))
    sync_feed(db, feed, fetcher(only_a1))
    assert statuses(db)["a2"] == ("suspect", 1)
    sync_feed(db, feed, fetcher(only_a1))
    assert statuses(db)["a2"] == ("expired", 2)
    assert statuses(db)["a1"] == ("active", 0)
    sync_feed(db, feed, fetcher(full))
    assert statuses(db)["a2"] == ("active", 0)


def test_an_empty_feed_changes_nothing(db, world):
    feed = feed_config(db, world)
    sync_feed(db, feed, fetcher(greenhouse(("a1", "Backend Engineer", "Bengaluru", None))))
    report = sync_feed(db, feed, fetcher(greenhouse()))
    assert report.status == "partial" and "not believed" in report.detail
    assert statuses(db)["a1"] == ("active", 0)


def test_a_feed_that_fails_is_reported_and_touches_no_job(db, world):
    feed = feed_config(db, world)
    sync_feed(db, feed, fetcher(greenhouse(("a1", "Backend Engineer", "Bengaluru", None))))
    for error in (FetchError("HTTP 500", retryable=True), FetchError("only https URLs are fetched")):
        report = sync_feed(db, feed, fetcher(error))
        assert report.status == "failed"
    assert statuses(db)["a1"] == ("active", 0)
    as_owner(db)
    assert db.execute("select last_run_status from source where id = %s", (world["source"],)).fetchone()["last_run_status"] == "failed"


def test_a_body_that_is_not_the_providers_shape_fails_the_feed(db, world):
    feed = feed_config(db, world)
    assert sync_feed(db, feed, fetcher("<html>maintenance</html>")).status == "failed"


def test_a_link_the_site_would_refuse_never_gets_in(db, world):
    feed = feed_config(db, world)
    body = greenhouse(
        ("ok", "Fine", "Bengaluru", "https://boards.greenhouse.io/pipeline-test/jobs/1"),
        ("phish", "Phish", "Bengaluru", "https://phish.example/apply"),
        ("plain", "Plain", "Bengaluru", "http://pipeline-test.example/insecure"),
    )
    report = sync_feed(db, feed, fetcher(body))
    assert report.counts["new"] == 1 and report.counts["skipped_in_feed"] == 2
    assert set(statuses(db)) == {"ok"}


def test_the_same_title_and_link_under_another_source_is_a_duplicate_not_an_error(db, world):
    feed = feed_config(db, world)
    as_owner(db)
    other = db.execute("insert into source (name, kind, permission_note) values ('Other', 'manual', 't') returning id").fetchone()["id"]
    db.execute(
        "insert into job (company_id, source_id, title, apply_url, status) values (%s, %s, 'Backend Engineer', 'https://pipeline-test.example/jobs/a1', 'active')",
        (world["company"], other),
    )
    as_pipeline(db)
    report = sync_feed(db, feed, fetcher(greenhouse(("a1", "Backend Engineer", "Bengaluru", None), ("a2", "Designer", "Bengaluru", None))))
    assert report.counts["duplicates"] == 1 and report.counts["new"] == 1


def test_a_changed_title_and_link_refresh_the_job(db, world):
    feed = feed_config(db, world)
    sync_feed(db, feed, fetcher(greenhouse(("a1", "Backend Engineer", "Bengaluru", None))))
    sync_feed(db, feed, fetcher(greenhouse(("a1", "Senior Backend Engineer", "Bengaluru", "https://pipeline-test.example/jobs/a1-new"))))
    as_owner(db)
    row = db.execute("select title, apply_url, title_norm from job where external_ref = 'a1' and company_id::text = %s", (world["company"],)).fetchone()
    assert row["title"] == "Senior Backend Engineer" and row["apply_url"].endswith("a1-new") and row["title_norm"] == "senior backend engineer"


def test_run_sync_does_not_beat_when_every_feed_failed(db, world):
    as_pipeline(db)
    reports = run_sync(db, fetcher(FetchError("HTTP 503", retryable=True)))
    assert [r.status for r in reports] == ["failed"]
    as_owner(db)
    assert db.execute("select last_ok_at from heartbeat where name = 'feed-sync'").fetchone()["last_ok_at"] is None


def make_jobs(db, world, n=1):
    as_owner(db)
    ids = []
    for i in range(n):
        ids.append(db.execute(
            "insert into job (company_id, source_id, title, apply_url, status) values (%s, %s, %s, %s, 'active') returning id::text as id",
            (world["company"], world["source"], f"Job {i}", f"https://pipeline-test.example/jobs/{i}"),
        ).fetchone()["id"])
    # The seed's jobs are live too. Mark them as checked later than anything these tests do (now() is fixed inside a
    # transaction, so "just now" would tie), so the checker reaches these jobs first, and again after they are checked.
    db.execute("update job set last_checked_at = now() + interval '1 day' where id <> all(%s::uuid[])", (ids,))
    as_pipeline(db)
    return ids


def requester(answers):
    """answers: url -> (status, final_url) or an exception."""
    def request(url, method):
        answer = answers[url]
        if isinstance(answer, Exception):
            raise answer
        status, final = answer
        return Response(status=status, final_url=final)
    return request


def test_the_link_checker_applies_two_strikes(db, world):
    (job,) = make_jobs(db, world)
    url = "https://pipeline-test.example/jobs/0"
    gone = requester({url: (404, url)})
    run_checks(db, limit=1, requester=gone)
    as_owner(db)
    assert db.execute("select status, consecutive_failures from job where id = %s", (job,)).fetchone() == {"status": "suspect", "consecutive_failures": 1}
    as_pipeline(db)
    report = run_checks(db, limit=1, requester=gone)
    assert report.expired == 1
    as_owner(db)
    assert db.execute("select status from job where id = %s", (job,)).fetchone()["status"] == "expired"
    assert db.execute("select count(*) as n from verification_check where job_id = %s", (job,)).fetchone()["n"] == 2


def test_a_good_check_clears_the_strikes(db, world):
    (job,) = make_jobs(db, world)
    url = "https://pipeline-test.example/jobs/0"
    run_checks(db, limit=1, requester=requester({url: (410, url)}))
    run_checks(db, limit=1, requester=requester({url: (200, url)}))
    as_owner(db)
    assert db.execute("select status, consecutive_failures, last_ok_at is not null as ok from job where id = %s", (job,)).fetchone() == {"status": "active", "consecutive_failures": 0, "ok": True}


def test_an_inconclusive_answer_records_nothing_against_the_job(db, world):
    (job,) = make_jobs(db, world)
    url = "https://pipeline-test.example/jobs/0"
    for answer in [(403, url), (429, url), (503, url), FetchError("timed out", retryable=True)]:
        report = run_checks(db, limit=1, requester=requester({url: answer}))
        assert report.inconclusive == 1 and report.gone == 0
    as_owner(db)
    assert db.execute("select status, consecutive_failures from job where id = %s", (job,)).fetchone() == {"status": "active", "consecutive_failures": 0}
    assert db.execute("select count(*) as n from verification_check where job_id = %s", (job,)).fetchone()["n"] == 0


def test_a_redirect_to_the_careers_index_counts_as_gone(db, world):
    (job,) = make_jobs(db, world)
    url = "https://pipeline-test.example/jobs/0"
    run_checks(db, limit=1, requester=requester({url: (200, "https://pipeline-test.example/careers")}))
    as_owner(db)
    assert db.execute("select status from job where id = %s", (job,)).fetchone()["status"] == "suspect"


def test_the_checker_goes_through_the_oldest_checks_first_and_respects_its_limit(db, world):
    ids = make_jobs(db, world, 3)
    as_owner(db)
    db.execute("update job set last_checked_at = now() - interval '1 day' where id = %s", (ids[0],))
    db.execute("update job set last_checked_at = now() where id = %s", (ids[1],))
    as_pipeline(db)
    first = repo.jobs_to_check(db, 2)
    assert [j["id"] for j in first] == [ids[2], ids[0]]  # never checked, then the oldest check
    assert len(repo.jobs_to_check(db, 1)) == 1


def test_a_job_that_is_not_live_is_logged_but_not_moved(db, world):
    (job,) = make_jobs(db, world)
    as_owner(db)
    db.execute("update job set status = 'expired' where id = %s", (job,))
    as_pipeline(db)
    assert repo.record_check(db, job, False, 404, None, "gone") == "expired"


def test_the_pipeline_role_can_do_its_work_and_nothing_else(db, world):
    (job,) = make_jobs(db, world)
    as_pipeline(db)
    for statement in [
        "update company set name = 'Hacked'",
        "delete from job",
        "delete from company",
        "insert into company (slug, name, domain, website_url) values ('x', 'x', 'x.test', 'https://x.test')",
        "update office set address = 'x'",
        "select * from admin_user",
        "select * from audit_log",
        "update city set data_version = 99",
        "select publish_now()",
        "select sweep_stale_jobs()",
    ]:
        with pytest.raises(psycopg.Error):
            with db.transaction():
                db.execute(statement)
    # What it may do.
    db.execute("select count(*) from company")
    db.execute("update job set status = 'suspect' where id = %s", (job,))
    db.execute("select record_heartbeat('feed-sync', 'x')")


def test_the_monitor_names_every_overdue_job_and_fails(db, world, capsys):
    as_owner(db)
    db.execute("update heartbeat set last_ok_at = now() where name <> 'link-check'")
    db.execute("update heartbeat set last_ok_at = now() - interval '2 days' where name = 'link-check'")
    as_pipeline(db)
    assert monitor(db) == 1
    out = capsys.readouterr().out
    assert "link-check" in out and "overdue" in out and "feed-sync" not in out
    as_owner(db)
    db.execute("update heartbeat set last_ok_at = now()")
    as_pipeline(db)
    assert monitor(db) == 0
    assert "finished in time" in capsys.readouterr().out
