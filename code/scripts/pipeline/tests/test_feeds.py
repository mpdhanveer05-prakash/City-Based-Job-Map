"""Feed parsers (P8-01): each provider's real shape, and every way a feed can be wrong."""
import json
from datetime import date

import pytest

from scripts.pipeline.feeds import feed_url, parse, parse_ashby, parse_greenhouse, parse_jsonld, parse_lever, parse_workable
from scripts.pipeline.models import FeedError


def test_greenhouse_reads_jobs_with_their_locations():
    body = json.dumps({"jobs": [
        {"id": 4001, "title": "  Backend   Engineer ", "absolute_url": "https://boards.greenhouse.io/acme/jobs/4001", "location": {"name": "Bengaluru, India"}, "updated_at": "2026-09-30T10:00:00-04:00"},
        {"id": 4002, "title": "Support", "absolute_url": "https://boards.greenhouse.io/acme/jobs/4002", "location": {"name": "Remote - India"}},
    ]})
    result = parse_greenhouse(body)
    assert [j.external_ref for j in result.jobs] == ["4001", "4002"]
    assert result.jobs[0].title == "Backend Engineer"
    assert result.jobs[0].location == "Bengaluru, India"
    assert result.jobs[0].posted_at == date(2026, 9, 30)
    assert result.jobs[1].remote and result.jobs[1].work_mode == "remote"
    assert result.skipped == 0


def test_lever_reads_postings_with_millisecond_dates():
    body = json.dumps([{"id": "abc-1", "text": "Data Scientist", "hostedUrl": "https://jobs.lever.co/acme/abc-1",
                        "categories": {"location": "Chennai"}, "workplaceType": "hybrid", "createdAt": 1790000000000}])
    (job,) = parse_lever(body).jobs
    assert (job.external_ref, job.title, job.location, job.work_mode) == ("abc-1", "Data Scientist", "Chennai", "hybrid")
    assert job.posted_at is not None and job.posted_at.year == 2026


def test_ashby_reads_remote_flag_and_published_date():
    body = json.dumps({"jobs": [{"id": "x1", "title": "Designer", "location": "Bengaluru", "isRemote": True, "jobUrl": "https://jobs.ashbyhq.com/acme/x1", "publishedAt": "2026-10-01T00:00:00Z"}]})
    (job,) = parse_ashby(body).jobs
    assert job.remote and job.work_mode == "remote" and job.posted_at == date(2026, 10, 1)


def test_workable_joins_city_and_country():
    body = json.dumps({"jobs": [{"shortcode": "AB12", "title": "QA", "url": "https://apply.workable.com/acme/j/AB12/", "city": "Chennai", "country": "India", "published_on": "2026-09-20"}]})
    (job,) = parse_workable(body).jobs
    assert job.location == "Chennai, India" and job.external_ref == "AB12"


def test_jsonld_reads_job_postings_from_a_careers_page_including_graphs_and_lists():
    page = """<html><head>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"SRE","url":"https://acme.example/careers/sre",
      "identifier":{"@type":"PropertyValue","value":"R-77"},"datePosted":"2026-09-25",
      "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"Bengaluru","addressRegion":"KA"}}}</script>
    <script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"Acme"},{"@type":["JobPosting"],"title":"PM","url":"https://acme.example/careers/pm","jobLocationType":"TELECOMMUTE"}]}</script>
    <script type="application/ld+json">[{"@type":"JobPosting","title":"No link"}]</script>
    <script type="application/ld+json">{ broken json </script>
    <script>var x = {"@type":"JobPosting","title":"Not a ld+json block"};</script>
    </head><body></body></html>"""
    result = parse_jsonld(page)
    assert [j.title for j in result.jobs] == ["SRE", "PM"]
    assert result.jobs[0].external_ref == "R-77" and result.jobs[0].location == "Bengaluru, KA"
    assert result.jobs[1].remote and result.jobs[1].external_ref == "https://acme.example/careers/pm"
    assert result.skipped == 1  # the posting with no link


@pytest.mark.parametrize("parser,body", [
    (parse_greenhouse, json.dumps({"jobs": [{"id": 1, "title": "No link"}, {"id": 2, "absolute_url": "https://x.example/2"}, {"title": "No id", "absolute_url": "https://x.example/3"}, {"id": 4, "title": "http", "absolute_url": "http://x.example/4"}, "junk", None]})),
    (parse_lever, json.dumps([{"id": "a", "text": "No url"}, {"text": "No id", "hostedUrl": "https://x.example/b"}, {"id": "c", "text": "javascript", "hostedUrl": "javascript:alert(1)"}])),
    (parse_ashby, json.dumps({"jobs": [{"id": "a", "title": "t"}, {"title": "t", "jobUrl": "https://x.example/b"}]})),
    (parse_workable, json.dumps({"jobs": [{"shortcode": "a", "title": "t"}, {"title": "t", "url": "https://x.example/b"}]})),
])
def test_entries_without_a_title_an_id_or_an_https_link_are_skipped_and_counted(parser, body):
    result = parser(body)
    assert result.jobs == []
    assert result.skipped >= 2


def test_a_job_listed_twice_is_one_job():
    body = json.dumps({"jobs": [{"id": 1, "title": "A", "absolute_url": "https://x.example/1"}, {"id": 1, "title": "A again", "absolute_url": "https://x.example/1"}]})
    result = parse_greenhouse(body)
    assert len(result.jobs) == 1 and result.skipped == 1


@pytest.mark.parametrize("parser,body", [
    (parse_greenhouse, "not json"), (parse_greenhouse, "[]"), (parse_greenhouse, '{"jobs": "x"}'),
    (parse_lever, "{}"), (parse_ashby, "[]"), (parse_workable, '{"nope": 1}'),
])
def test_a_body_that_is_not_the_providers_shape_is_a_feed_error(parser, body):
    with pytest.raises(FeedError):
        parser(body)


def test_titles_are_cleaned_and_capped():
    body = json.dumps({"jobs": [{"id": 1, "title": "x" * 1000, "absolute_url": "https://x.example/1"}]})
    assert len(parse_greenhouse(body).jobs[0].title) == 300


def test_feed_urls_come_from_a_fixed_host_and_a_checked_board_name():
    assert feed_url("greenhouse", "acme") == "https://boards-api.greenhouse.io/v1/boards/acme/jobs"
    assert feed_url("lever", "acme-co") == "https://api.lever.co/v0/postings/acme-co?mode=json"
    assert feed_url("jsonld", "https://acme.example/careers") == "https://acme.example/careers"
    for bad in ["../etc", "a/b", "a b", "", "x@evil.test", "a?b=c", "-start"]:
        with pytest.raises(FeedError):
            feed_url("greenhouse", bad)
    with pytest.raises(FeedError):
        feed_url("nonsense", "acme")


def test_parse_dispatches_by_provider_and_refuses_an_unknown_one():
    assert parse("lever", "[]").jobs == []
    with pytest.raises(FeedError):
        parse("nonsense", "[]")
