"""Source checks for evidence (ADR-0022): the rules, and the run against a real database as the pipeline role."""
import json

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
