"""The sync rules (P8-01) and the apply-link rule: pure, so no database is needed."""
import hashlib

import pytest

from scripts.pipeline.links import KNOWN_ATS_HOSTS, acceptable_apply_link, company_owns
from scripts.pipeline.models import FeedJob
from scripts.pipeline.plan import ExistingJob, cities_for, dedup_hash, plan_sync, title_norm


def feed_job(ref, title="Engineer", url=None, location="Bengaluru", remote=False):
    return FeedJob(ref, title, url or f"https://acme.example/jobs/{ref}", location, remote=remote)


def existing(ref, status="active", failures=0):
    return ExistingJob(id=f"id-{ref}", external_ref=ref, title="Engineer", apply_url=f"https://acme.example/jobs/{ref}", status=status, consecutive_failures=failures)


def test_new_jobs_are_inserted_and_known_ones_refreshed():
    plan = plan_sync([existing("1"), existing("2")], [feed_job("2"), feed_job("3")])
    assert [j.external_ref for j in plan.inserts] == ["3"]
    assert [(e.external_ref, f.external_ref) for e, f in plan.refresh] == [("2", "2")]
    assert plan.counts() == {"new": 1, "refreshed": 1, "suspect": 1, "expired": 0}


def test_a_live_job_missing_from_the_feed_is_suspect_the_first_time_and_expired_the_second():
    first = plan_sync([existing("1", "active")], [feed_job("2")])
    assert [j.external_ref for j in first.suspect] == ["1"] and first.expire == []
    second = plan_sync([existing("1", "suspect", 1)], [feed_job("2")])
    assert [j.external_ref for j in second.expire] == ["1"] and second.suspect == []


def test_a_job_that_comes_back_is_refreshed_not_inserted_again():
    plan = plan_sync([existing("1", "suspect", 1), existing("9", "expired", 2)], [feed_job("1"), feed_job("9")])
    assert plan.inserts == [] and len(plan.refresh) == 2 and plan.suspect == [] and plan.expire == []


def test_jobs_that_are_not_live_are_left_alone_when_missing():
    plan = plan_sync([existing("1", "expired", 2), existing("2", "draft"), existing("3", "withdrawn")], [feed_job("9")])
    assert plan.suspect == [] and plan.expire == []


def test_jobs_with_no_external_ref_are_never_touched_by_a_feed():
    manual = ExistingJob(id="m", external_ref=None, title="By hand", apply_url="https://acme.example/m", status="active")
    plan = plan_sync([manual], [feed_job("1")])
    assert plan.suspect == [] and plan.expire == []


def test_an_empty_feed_is_not_believed_when_the_company_has_live_jobs():
    plan = plan_sync([existing("1"), existing("2", "suspect", 1)], [])
    assert plan.guarded and "not believed" in plan.guarded
    assert plan.counts() == {"new": 0, "refreshed": 0, "suspect": 0, "expired": 0}


def test_an_empty_feed_for_a_company_with_no_live_jobs_is_just_empty():
    assert plan_sync([existing("1", "expired", 2)], []).guarded is None
    assert plan_sync([], []).guarded is None


OFFICES = {"bangalore": ["Bengaluru", "bangalore", "Bangalore", "BLR"], "chennai": ["Chennai", "chennai", "Madras"]}


@pytest.mark.parametrize("location,remote,expected", [
    ("Bengaluru, India", False, ["bangalore"]),
    ("Bangalore", False, ["bangalore"]),
    ("Chennai or Bengaluru", False, ["bangalore", "chennai"]),
    ("Madras", False, ["chennai"]),
    ("Remote", True, ["bangalore", "chennai"]),
    ("", False, ["bangalore", "chennai"]),
    ("Pune", False, []),
    ("Bengaluru Rural Pune", False, ["bangalore"]),
    ("Remote - Pune", True, ["bangalore", "chennai"]),
    ("Chennaiville", False, []),
])
def test_cities_follow_the_location_text(location, remote, expected):
    assert cities_for(feed_job("1", location=location, remote=remote), OFFICES) == expected


def test_a_company_with_one_office_city_lists_a_remote_job_only_there():
    assert cities_for(feed_job("1", location="Remote", remote=True), {"chennai": ["Chennai"]}) == ["chennai"]


def test_the_hash_matches_what_the_database_computes():
    assert title_norm("  Senior Backend ENGINEER ") == "senior backend engineer"
    expected = hashlib.md5(b"00000000-0000-4000-8000-0000000000c1|senior backend engineer|https://pub.test/careers/1").digest()
    assert dedup_hash("00000000-0000-4000-8000-0000000000c1", " Senior Backend ENGINEER ", "https://pub.test/careers/1") == expected


@pytest.mark.parametrize("url,ok", [
    ("https://acme.example/careers/1", True),
    ("https://careers.acme.example/x", True),
    ("https://www.acme.example/x", True),
    ("https://boards.greenhouse.io/acme/jobs/1", True),
    ("https://acme.myworkdayjobs.com/en/x", True),
    ("http://acme.example/x", False),
    ("https://evil-acme.example/x", False),
    ("https://acme.example.evil.test/x", False),
    ("https://greenhouse.io.evil.test/x", False),
    ("https://user:pw@acme.example/x", False),
    ("javascript:alert(1)", False),
    ("", False),
])
def test_apply_links_must_be_the_companys_or_a_known_ats(url, ok):
    assert acceptable_apply_link(url, "acme.example") is ok


def test_company_owns_only_its_own_domain():
    assert company_owns("https://acme.example/careers", "acme.example")
    assert company_owns("https://acme.example/careers", "www.acme.example")
    assert not company_owns("https://boards.greenhouse.io/acme", "acme.example")


def test_the_ats_list_matches_the_sites():
    # lib/links.ts keeps the same list; this reads it so the two cannot drift apart.
    import pathlib
    import re
    ts = pathlib.Path(__file__).resolve().parents[3] / "lib" / "links.ts"
    block = re.search(r"KNOWN_ATS_HOSTS: readonly string\[\] = \[(.*?)\];", ts.read_text(encoding="utf-8"), re.S).group(1)
    assert sorted(re.findall(r'"([^"]+)"', block)) == sorted(KNOWN_ATS_HOSTS)
