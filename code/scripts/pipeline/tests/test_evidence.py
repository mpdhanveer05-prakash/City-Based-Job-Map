"""Source checks for evidence (ADR-0022): the rules, and the run against a real database as the pipeline role."""
import json

import psycopg
import pytest

from scripts.pipeline import repo
from scripts.pipeline.evidence import judge, page_text, run_evidence_checks
from scripts.pipeline.fetch import FetchError, Response
from scripts.pipeline.sync import sync_feed

from .conftest import as_owner, as_pipeline


def ok(body, status=200):
    return Response(status=status, final_url="https://x.test/", body=body)


def test_page_text_drops_markup_scripts_and_case():
    assert page_text("<p>Acme&nbsp;<b>Labs</b></p><script>var x='Hidden'</script>") == "acme labs"


def test_a_value_on_the_page_is_found_whatever_its_markup_or_case():
    assert judge("text", "Acme Labs", ok("<h1>ACME <span>labs</span></h1>")).outcome == "value_found"


def test_a_page_without_the_value_is_a_possible_change_not_a_confirmed_one():
    o = judge("text", "Acme Labs", ok("<h1>Other Co</h1>"))
    assert o.outcome == "value_not_found" and o.http_status == 200


def test_a_failed_fetch_says_nothing_about_the_value():
    assert judge("text", "Acme", ok("", status=503)).outcome == "fetch_failed"
    assert judge("text", "Acme", None, "timed out").outcome == "fetch_failed"
    assert judge("reachable", "x", ok("", status=404)).outcome == "fetch_failed"


def test_a_classification_is_only_checked_for_reachability():
    assert judge("reachable", "mnc,product", ok("<p>We are a startup</p>")).outcome == "reachable"


def greenhouse(*jobs):
    return json.dumps({"jobs": [
        {"id": ref, "title": title, "absolute_url": f"https://pipeline-test.example/jobs/{ref}", "location": {"name": "Bengaluru"}}
        for ref, title in jobs
    ]})


def test_a_feed_read_records_evidence_for_each_job_once(db, world):
    as_pipeline(db)
    (feed,) = repo.load_feeds(db)
    sync_feed(db, feed, lambda url: greenhouse(("e1", "Data Engineer")))
    sync_feed(db, feed, lambda url: greenhouse(("e1", "Data Engineer")))
    as_owner(db)
    rows = db.execute(
        "select field, value, verified_at = current_date as today, reviewed_at from field_evidence e join job j on j.id = e.job_id where j.external_ref = 'e1' order by field"
    ).fetchall()
    assert [r["field"] for r in rows] == ["apply_url", "employer", "location", "title"]
    assert all(r["today"] and r["reviewed_at"] is None for r in rows)
    assert [r["value"] for r in rows if r["field"] == "employer"] == ["Pipeline Test Co"]
    # A changed title is new evidence; the old evidence stays, for the old value.
    as_pipeline(db)
    sync_feed(db, feed, lambda url: greenhouse(("e1", "Senior Data Engineer")))
    as_owner(db)
    titles = db.execute("select value from field_evidence e join job j on j.id = e.job_id where j.external_ref = 'e1' and field = 'title' order by e.id").fetchall()
    assert [t["value"] for t in titles] == ["Data Engineer", "Senior Data Engineer"]


def test_due_evidence_is_checked_and_the_verified_date_never_moves(db, world):
    db.execute(
        "insert into field_evidence (company_id, field, source_url, verified_at) values (%s, 'name', 'https://pipeline-test.example/about', date '2026-01-01')",
        (world["company"],),
    )
    as_pipeline(db)
    pages = {"https://pipeline-test.example/about": ok("<title>Something else</title>")}
    report = run_evidence_checks(db, limit=50, requester=lambda url: pages[url] if url in pages else (_ for _ in ()).throw(FetchError("refused")))
    assert report.not_found >= 1
    as_owner(db)
    row = db.execute(
        "select e.verified_at::text as v, c.outcome from field_evidence e join evidence_check c on c.evidence_id = e.id where e.company_id = %s and e.field = 'name'",
        (world["company"],),
    ).fetchone()
    assert row == {"v": "2026-01-01", "outcome": "value_not_found"}
    # Checked: not due again until the field's interval passes.
    as_pipeline(db)
    assert run_evidence_checks(db, limit=50, requester=lambda url: ok("Pipeline Test Co")).checked == 0


def test_only_an_approved_feed_is_read(db, world):
    db.execute("update job_feed set approved_by = null, approved_at = null where id = %s", (world["feed"],))
    as_pipeline(db)
    assert repo.load_feeds(db) == []


def test_a_signed_in_editor_cannot_approve_a_feed_and_a_reviewer_must_say_why(db, world):
    db.execute("update job_feed set approved_by = null, approved_at = null where id = %s", (world["feed"],))
    uid = db.execute("insert into auth.users (id) values (gen_random_uuid()) returning id::text as id").fetchone()["id"]
    db.execute("insert into admin_user (user_id, role) values (%s, 'editor')", (uid,))
    db.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"sub": uid, "role": "authenticated"}),))
    db.execute("savepoint s1")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("update job_feed set approved_by = %s, approved_at = now() where id = %s", (uid, world["feed"]))
    db.execute("rollback to savepoint s1")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("select approve_job_feed(%s, 'it is official')", (world["feed"],))
    db.execute("rollback to savepoint s1")
    db.execute("update admin_user set role = 'reviewer' where user_id = %s", (uid,))
    db.execute("savepoint s2")
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute("select approve_job_feed(%s, '  ')", (world["feed"],))
    db.execute("rollback to savepoint s2")
    db.execute("select approve_job_feed(%s, 'Greenhouse board linked from the careers page')", (world["feed"],))
    row = db.execute("select approved_by::text as by, approval_note from job_feed where id = %s", (world["feed"],)).fetchone()
    assert row == {"by": uid, "approval_note": "Greenhouse board linked from the careers page"}
    # Pointing the feed somewhere else withdraws the approval.
    db.execute("update job_feed set identifier = 'another-board' where id = %s", (world["feed"],))
    assert db.execute("select approved_at from job_feed where id = %s", (world["feed"],)).fetchone()["approved_at"] is None
    db.execute("select set_config('request.jwt.claims', '', true)")


def test_a_link_moved_to_another_domain_is_held_recorded_and_not_applied(db, world):
    as_pipeline(db)
    (feed,) = repo.load_feeds(db)
    sync_feed(db, feed, lambda url: greenhouse(("d1", "Data Engineer")))
    moved = json.dumps({"jobs": [{"id": "d1", "title": "Data Engineer", "absolute_url": "https://job-boards.greenhouse.io/pipeline-test/jobs/d1", "location": {"name": "Bengaluru"}}]})
    sync_feed(db, feed, lambda url: moved)
    as_owner(db)
    job = db.execute("select apply_url, status from job where external_ref = 'd1'").fetchone()
    assert job == {"apply_url": "https://pipeline-test.example/jobs/d1", "status": "active"}
    events = db.execute("select kind, old_value, new_value from feed_event e join job j on j.id = e.job_id where j.external_ref = 'd1' order by e.id").fetchall()
    assert [e["kind"] for e in events] == ["inserted", "held_domain_change"]
    assert events[1]["new_value"] == "https://job-boards.greenhouse.io/pipeline-test/jobs/d1"
    note = db.execute("select note from field_evidence e join job j on j.id = e.job_id where j.external_ref = 'd1' and field = 'title'").fetchone()["note"]
    assert note.startswith(f"read from approved feed #{world['feed']} (greenhouse pipeline-test)")


def test_another_employers_ats_posting_is_not_published(db, world):
    as_pipeline(db)
    (feed,) = repo.load_feeds(db)
    other = json.dumps({"jobs": [{"id": "x1", "title": "Spy", "absolute_url": "https://job-boards.greenhouse.io/othercorp/jobs/1", "location": {"name": "Bengaluru"}}]})
    report = sync_feed(db, feed, lambda url: other)
    assert report.counts.get("new", 0) == 0
    as_owner(db)
    assert db.execute("select count(*) as n from job where external_ref = 'x1'").fetchone()["n"] == 0
