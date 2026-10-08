"""Tests for the Bengaluru pilot scripts (P9-20): the research check (verify_research.py) and the import builder
(build_import.py). No network: page fetches and geocoder lookups are replaced, and every file goes to a temporary folder.
Run from code/: python -m pytest scripts/pilot/tests"""
from __future__ import annotations

import io
import json

import pytest

from scripts.pilot import build_import, verify_research

DOMAIN = "acme.example"
ADDRESS = "Level 5, Prestige Tower, 12 MG Road, Bengaluru, Karnataka 560001"
PAGE = f"About Acme Labs. Acme Labs builds payment software. Visit us at {ADDRESS}. Acme is listed on the NSE."


def company(**over):
    base = {
        "candidate": "Acme Labs",
        "name": "Acme Labs",
        "domain": DOMAIN,
        "website_url": f"https://{DOMAIN}",
        "address": ADDRESS,
        "description": "Acme Labs builds payment software.",
        "types": ["product"],
        "sectors": ["fintech"],
        "ownership_status": "public",
        "evidence": {
            "name": {"url": f"https://{DOMAIN}/about", "quote": "About Acme Labs"},
            "website": {"url": f"https://{DOMAIN}/", "quote": "Acme Labs builds"},
            "address": {"url": f"https://{DOMAIN}/contact", "quote": "12 MG Road"},
            "description": {"url": f"https://{DOMAIN}/about", "quote": "builds payment software"},
            "types": {"url": f"https://{DOMAIN}/about", "quote": "payment software"},
            "sectors": {"url": f"https://{DOMAIN}/about", "quote": "payment software"},
            "ownership_status": {"url": f"https://{DOMAIN}/investors", "quote": "Acme is listed on the NSE"},
        },
    }
    base.update(over)
    return base


@pytest.fixture
def pages(monkeypatch):
    """Replaces the page fetch: maps a URL to its raw text, or to None for a page that cannot be read."""
    served: dict[str, str | None] = {}
    monkeypatch.setattr(verify_research, "_cache", {})
    monkeypatch.setattr(verify_research, "fetch", lambda url: (verify_research.fold(served[url]), None) if served.get(url) is not None else (None, "HTTP 404"))
    return served


# ---- verify_research.check ------------------------------------------------------------------------------------------------


def test_a_fact_found_on_the_official_page_is_verified(pages):
    for path in ("about", "", "contact", "investors"):
        pages[f"https://{DOMAIN}/{path}"] = PAGE
    c = company()
    assert {f: verify_research.check(c, f)["outcome"] for f in verify_research.FIELDS} == {f: "verified" for f in verify_research.FIELDS}


@pytest.mark.parametrize(
    "field, change, outcome",
    [
        ("description", {"description": None}, "empty"),
        ("types", {"types": []}, "empty"),
        ("description", {"evidence": {"description": {"url": f"https://{DOMAIN}/about"}}}, "no_evidence"),
        ("name", {"evidence": {"name": {"url": "https://news.example/acme", "quote": "About Acme Labs"}}}, "not_official"),
        ("name", {"evidence": {"name": {"url": f"http://{DOMAIN}/about", "quote": "About Acme Labs"}}}, "not_official"),
        ("name", {"evidence": {"name": {"url": f"https://{DOMAIN}/missing", "quote": "About Acme Labs"}}}, "fetch_failed"),
        ("name", {"evidence": {"name": {"url": f"https://{DOMAIN}/about", "quote": "a sentence nobody wrote"}}}, "quote_not_found"),
        ("name", {"name": "Acme Payments Private Limited"}, "name_not_on_page"),
        ("address", {"address": "12 MG Road, Pune 411001"}, "not_bengaluru"),
        ("address", {"address": "Level 9, 12 MG Road, Bengaluru 560001"}, "full_address_not_on_page"),
        ("ownership_status", {"evidence": {"ownership_status": {"url": f"https://{DOMAIN}/about", "quote": "About Acme Labs"}}}, "no_exchange_named"),
        ("ownership_status", {"ownership_status": "private"}, "no_exchange_named"),
    ],
)
def test_a_fact_is_dropped_unless_its_page_supports_it(pages, field, change, outcome):
    pages[f"https://{DOMAIN}/about"] = PAGE
    pages[f"https://{DOMAIN}/contact"] = PAGE
    pages[f"https://{DOMAIN}/investors"] = PAGE
    c = company()
    evidence = {**c["evidence"], **change.pop("evidence", {})}
    c.update(change, evidence=evidence)
    assert verify_research.check(c, field)["outcome"] == outcome


def test_typographic_variants_and_subdomains_count_as_the_same(pages):
    assert verify_research.fold("Acme’s “Best” – Labs") == verify_research.fold("acme's \"best\" - labs")
    assert verify_research.on_domain(f"https://careers.{DOMAIN}/x", DOMAIN)
    assert not verify_research.on_domain(f"https://{DOMAIN}.evil.example/x", DOMAIN)


def test_only_companies_with_a_verified_name_website_and_address_become_candidates(tmp_path, monkeypatch, pages):
    monkeypatch.setattr(verify_research, "ROOT", tmp_path)
    (tmp_path / "research").mkdir()
    for path in ("about", "", "contact", "investors"):
        pages[f"https://{DOMAIN}/{path}"] = PAGE
    no_address = company(candidate="Other", name="Other Co", domain="other.example", website_url="https://other.example",
                         evidence={**company()["evidence"], "name": {"url": "https://other.example/", "quote": "Other Co"}})
    pages["https://other.example/"] = "Other Co"
    weak_description = company(evidence={**company()["evidence"], "description": {"url": f"https://{DOMAIN}/about", "quote": "not on the page"}})
    (tmp_path / "research" / "group-a.json").write_text(json.dumps([no_address, weak_description]), encoding="utf-8")
    verify_research.main()
    candidates = json.loads((tmp_path / "candidates.json").read_text(encoding="utf-8"))["candidates"]
    assert [c["name"] for c in candidates] == ["Acme Labs"]
    acme = candidates[0]
    assert acme["description"] is None and acme["dropped"] == {"description": "quote_not_found"}
    assert "description" not in acme["evidence"]
    report = json.loads((tmp_path / "verification.json").read_text(encoding="utf-8"))["companies"]
    assert {r["candidate"] for r in report} == {"Other", "Acme Labs"}


def test_a_later_research_round_replaces_an_earlier_one_only_by_passing_the_same_checks(tmp_path, monkeypatch, pages):
    monkeypatch.setattr(verify_research, "ROOT", tmp_path)
    (tmp_path / "research").mkdir()
    for path in ("about", "", "contact", "investors"):
        pages[f"https://{DOMAIN}/{path}"] = PAGE
    first = company(description=None)
    later = company()
    failing_later = company(evidence={**company()["evidence"], "address": {"url": f"https://{DOMAIN}/contact", "quote": "not there"}})
    (tmp_path / "research" / "group-a.json").write_text(json.dumps([first]), encoding="utf-8")
    (tmp_path / "research" / "group-r2.json").write_text(json.dumps([later, failing_later]), encoding="utf-8")
    verify_research.main()
    candidates = json.loads((tmp_path / "candidates.json").read_text(encoding="utf-8"))["candidates"]
    assert len(candidates) == 1 and candidates[0]["description"] == "Acme Labs builds payment software."


# ---- build_import ---------------------------------------------------------------------------------------------------------


@pytest.fixture
def pilot_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(build_import, "ROOT", tmp_path)
    monkeypatch.setattr(build_import, "CACHE", tmp_path / "geocode-cache.json")
    monkeypatch.setattr(build_import.time, "sleep", lambda _s: None)
    return tmp_path


def candidates_file(root, *candidates):
    (root / "candidates.json").write_text(json.dumps({"candidates": list(candidates)}), encoding="utf-8")


def verified(**over):
    c = company()
    base = {
        "name": c["name"], "domain": "WWW.Acme.Example", "website_url": c["website_url"], "address": ADDRESS,
        "verified_at": "2026-10-06", "description": c["description"], "types": ["product"], "sectors": [],
        "ownership_status": None, "research_note": None, "dropped": {"ownership_status": "no_exchange_named"},
        "evidence": {f: {"url": c["evidence"][f]["url"]} for f in ("name", "website", "address", "description", "types")},
    }
    base.update(over)
    return base


def test_rows_carry_one_evidence_item_per_verified_fact(pilot_dir, monkeypatch):
    monkeypatch.setattr(build_import, "geocode", lambda _a, _c: {"lat": 12.97, "lng": 77.6, "accuracy": "building", "osm": "MG Road", "osm_type": "building"})
    candidates_file(pilot_dir, verified())
    out, skipped = build_import.rows()
    assert skipped == []
    row = out[0]
    assert row["domain"] == "acme.example"
    assert row["startup_stage"] is None and row["careers_url"] is None
    fields = [(e["field"], e["source_url"]) for e in row["evidence"]]
    # Location is evidenced by the address page; sectors and ownership were not verified, so they have no evidence.
    assert fields == [("name", f"https://{DOMAIN}/about"), ("website", f"https://{DOMAIN}/"), ("address", f"https://{DOMAIN}/contact"),
                      ("location", f"https://{DOMAIN}/contact"), ("description", f"https://{DOMAIN}/about"), ("types", f"https://{DOMAIN}/about")]
    assert all(e["verified_at"] == "2026-10-06" for e in row["evidence"])
    assert "D-07" in row["_review_notes"]["geocode"]


def test_a_company_the_geocoder_cannot_place_is_skipped_never_guessed(pilot_dir, monkeypatch):
    monkeypatch.setattr(build_import, "geocode", lambda _a, _c: None)
    candidates_file(pilot_dir, verified())
    out, skipped = build_import.rows()
    assert out == [] and skipped == [{"name": "Acme Labs", "reason": "the address could not be placed in Bengaluru by the geocoder"}]


def test_a_fallback_geocode_is_marked_locality_so_a_person_places_it(pilot_dir, monkeypatch):
    asked = []

    def lookup(text):
        asked.append(text)
        return {"lat": 12.97, "lng": 77.6, "accuracy": "building", "osm": "Bengaluru", "osm_type": "city"} if len(asked) > 1 else None

    monkeypatch.setattr(build_import, "_lookup", lookup)
    cache: dict = {}
    point = build_import.geocode(ADDRESS, cache)
    assert asked[0] == ADDRESS and len(asked) == 2
    assert point["accuracy"] == "locality" and "fallback query" in point["osm"]
    assert json.loads(build_import.CACHE.read_text(encoding="utf-8"))[ADDRESS] == point
    assert build_import.geocode(ADDRESS, cache) == point and len(asked) == 2  # cached: no second lookup


@pytest.mark.parametrize(
    "hit, expected",
    [
        ({"lat": "12.97", "lon": "77.60", "addresstype": "building", "display_name": "x"}, "building"),
        ({"lat": "12.97", "lon": "77.60", "addresstype": "road", "display_name": "x"}, "street"),
        ({"lat": "12.97", "lon": "77.60", "addresstype": "suburb", "display_name": "x"}, "locality"),
        ({"lat": "18.52", "lon": "73.85", "addresstype": "building", "display_name": "Pune"}, None),
    ],
)
def test_a_lookup_outside_bengaluru_is_not_a_match(pilot_dir, monkeypatch, hit, expected):
    class Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(build_import.urllib.request, "urlopen", lambda _req, timeout: Response(json.dumps([hit]).encode()))
    result = build_import._lookup("anything")
    assert (result or {}).get("accuracy") == expected


def test_import_refuses_any_database_but_a_local_one(monkeypatch):
    monkeypatch.setenv("LOCAL_DATABASE_URL", "postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres")
    with pytest.raises(SystemExit, match="LOCAL database only"):
        build_import.import_local([])
