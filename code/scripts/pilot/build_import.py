"""Bengaluru pilot: turns the verified candidates into import rows, geocodes their addresses for LOCAL review, and (with
--import) imports them into the LOCAL database as drafts. Run from code/:

    python -m scripts.pilot.build_import            # writes data/pilot/bangalore/import-rows.json and pilot.csv
    LOCAL_DATABASE_URL=... python -m scripts.pilot.build_import --import

Rules:
  * Only facts that scripts/pilot/verify_research.py verified against the raw page are used; each keeps its own
    source URL. verified_at is the date that script checked the page.
  * Coordinates come from OpenStreetMap's Nominatim, at most one request a second, cached in geocode-cache.json. They
    are FOR LOCAL REVIEW ONLY: OSM data is ODbL-licensed, and the geocoding provider for production is the owner's open
    decision D-07. Before publication, every point must be re-derived with the chosen provider and reviewed on the map.
    The location evidence says so in its note. A point Nominatim could not place precisely is marked low accuracy, so
    it lands in the review queue.
  * --import calls import_commit as a local pilot editor: every company and office lands as a DRAFT, every piece of
    evidence as a CLAIM. Nothing is reviewed or published by this script.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "data" / "pilot" / "bangalore"
CACHE = ROOT / "geocode-cache.json"
USER_AGENT = "company-map-pilot/0.1 (local review; https://github.com/mpdhanveer05-prakash/City-Based-Job-Map)"
# Bengaluru, roughly: a geocode outside this box is treated as not found.
BOX = {"lat": (12.7, 13.3), "lng": (77.3, 77.9)}
PILOT_EDITOR = "00000000-0000-4000-8000-0000000071a0"


def geocode(address: str, cache: dict) -> dict | None:
    """The full address first; if Nominatim cannot place it, the trailing parts (area, city, PIN code) only. A fallback
    point is marked locality accuracy, so the office goes to the review queue for a person to place it properly."""
    if address in cache:
        return cache[address]
    parts = [p.strip() for p in address.replace(" - ", ", ").split(",") if p.strip()]
    tries = [address] + [", ".join(parts[-n:]) for n in (4, 3, 2) if len(parts) > n]
    result = None
    for i, text in enumerate(tries):
        result = _lookup(text)
        if result:
            if i > 0:
                result = {**result, "accuracy": "locality", "osm": f"{result['osm']} (fallback query: {text})"}
            break
    cache[address] = result
    CACHE.write_text(json.dumps(cache, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return result


def _lookup(address: str) -> dict | None:
    query = urllib.parse.urlencode({"q": address, "format": "jsonv2", "countrycodes": "in", "limit": 1, "addressdetails": 0})
    req = urllib.request.Request(f"https://nominatim.openstreetmap.org/search?{query}", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            found = json.loads(r.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001 - a failed lookup is recorded, never guessed
        found = []
        print(f"geocode failed for {address[:60]}: {e}")
    time.sleep(1.1)  # Nominatim's usage policy: at most one request a second
    hit = found[0] if found else None
    result = None
    if hit:
        lat, lng = float(hit["lat"]), float(hit["lon"])
        if BOX["lat"][0] <= lat <= BOX["lat"][1] and BOX["lng"][0] <= lng <= BOX["lng"][1]:
            kind = hit.get("addresstype") or hit.get("type") or ""
            accuracy = "building" if kind in ("building", "house", "office", "commercial") else "street" if kind in ("road", "street") else "locality"
            result = {"lat": round(lat, 6), "lng": round(lng, 6), "accuracy": accuracy, "osm": hit.get("display_name"), "osm_type": kind}
    return result


def rows() -> tuple[list[dict], list[dict]]:
    data = json.loads((ROOT / "candidates.json").read_text(encoding="utf-8"))
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    out, skipped = [], []
    for c in data["candidates"]:
        point = geocode(c["address"], cache)
        if point is None:
            skipped.append({"name": c["name"], "reason": "the address could not be placed in Bengaluru by the geocoder"})
            continue
        ev = c["evidence"]
        date = c["verified_at"]
        evidence = [{"field": "name", "source_url": ev["name"]["url"], "verified_at": date},
                    {"field": "website", "source_url": ev["website"]["url"], "verified_at": date},
                    {"field": "address", "source_url": ev["address"]["url"], "verified_at": date},
                    {"field": "location", "source_url": ev["address"]["url"], "verified_at": date}]
        for f in ("description", "types", "sectors", "ownership_status"):
            if f in ev and c.get(f):
                evidence.append({"field": f, "source_url": ev[f]["url"], "verified_at": date})
        out.append({
            "name": c["name"],
            "domain": c["domain"].lower().removeprefix("www."),
            "website_url": c["website_url"],
            "careers_url": None,
            "description": c.get("description"),
            "types": c.get("types") or [],
            "startup_stage": None,
            "ownership_status": c.get("ownership_status"),
            "sectors": c.get("sectors") or [],
            "city": "bangalore",
            "address": c["address"],
            "lat": point["lat"],
            "lng": point["lng"],
            "accuracy": point["accuracy"],
            "neighbourhood": None,
            "tech_park": None,
            "evidence": evidence,
            "_review_notes": {
                "geocode": f"Nominatim (OSM) matched '{point['osm']}' ({point['osm_type']}); local review only, re-derive before publication (D-07)",
                "research": c.get("research_note"),
                "dropped": c.get("dropped"),
            },
        })
    return out, skipped


def write_files(out: list[dict], skipped: list[dict]) -> None:
    (ROOT / "import-rows.json").write_text(json.dumps({"rows": out, "skipped": skipped}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    cols = ["name", "domain", "website_url", "description", "types", "ownership_status", "sectors", "city", "address", "lat", "lng", "accuracy"]
    with (ROOT / "pilot.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cols + ["evidence"])
        for r in out:
            w.writerow([";".join(r[c]) if isinstance(r[c], list) else ("" if r[c] is None else r[c]) for c in cols]
                       + ["; ".join(f"{e['field']}={e['source_url']}" for e in r["evidence"])])


def import_local(out: list[dict]) -> None:
    import psycopg
    from psycopg.rows import dict_row

    dsn = os.environ["LOCAL_DATABASE_URL"]
    if "127.0.0.1" not in dsn and "localhost" not in dsn:
        raise SystemExit("refusing: --import is for the LOCAL database only")
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        conn.execute("insert into auth.users (id, email) values (%s, 'pilot-editor@local.test') on conflict do nothing", (PILOT_EDITOR,))
        conn.execute("insert into admin_user (user_id, role) values (%s, 'editor') on conflict do nothing", (PILOT_EDITOR,))
        # A local stand-in for a signed-in editor who passed the second factor (P9-13); --import refuses a non-local database.
        conn.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"sub": PILOT_EDITOR, "role": "authenticated", "aal": "aal2"}),))
        conn.execute("set local role authenticated")
        payload = [{k: v for k, v in r.items() if not k.startswith("_")} for r in out]
        result = conn.execute("select import_commit('bengaluru-pilot.json', %s::jsonb) as r", (json.dumps(payload),)).fetchone()["r"]
        conn.commit()
    print(json.dumps({k: result[k] for k in ("rows", "created_companies", "attached_offices", "skipped", "errors")}))
    for line in result["results"]:
        if line["result"] == "error":
            print("  error:", line)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--import", dest="do_import", action="store_true")
    args = parser.parse_args()
    out, skipped = rows()
    write_files(out, skipped)
    print(f"{len(out)} import rows; {len(skipped)} not placed by the geocoder")
    for s in skipped:
        print("  skipped:", s["name"], "-", s["reason"])
    if args.do_import:
        import_local(out)


if __name__ == "__main__":
    main()
