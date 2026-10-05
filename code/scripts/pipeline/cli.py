"""Command line for the scheduled jobs (P8-01 to P8-03). Run from `code/`:

    python -m scripts.pipeline.cli sync        # read every active feed
    python -m scripts.pipeline.cli linkcheck   # check apply links, oldest first
    python -m scripts.pipeline.cli monitor     # fail if a scheduled job is overdue

Each reads PIPELINE_DATABASE_URL (the pipeline login role, never the service role). Exit code 1 means something needs a person:
a run where every feed failed, or a scheduled job that has not finished in time.
"""
from __future__ import annotations

import argparse
import sys

from . import repo
from .linkcheck import run_checks
from .sync import run_sync


def monitor(conn) -> int:
    missed = repo.missed_heartbeats(conn)
    if not missed:
        print("monitor: every scheduled job finished in time")
        return 0
    print("monitor: scheduled jobs are overdue:")
    for row in missed:
        last = row["last_ok_at"].isoformat(timespec="minutes") if row["last_ok_at"] else "never"
        print(f"  {row['name']}: last finished {last}, should finish every {row['expected_every']}, overdue by {row['overdue']}")
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pipeline")
    parser.add_argument("command", choices=["sync", "linkcheck", "monitor"])
    parser.add_argument("--limit", type=int, default=500, help="links to check in one run (linkcheck)")
    args = parser.parse_args(argv)

    with repo.connect() as conn:
        if args.command == "monitor":
            return monitor(conn)
        if args.command == "sync":
            reports = run_sync(conn)
            for r in reports:
                print(f"{r.status:7} {r.company}/{r.provider}: {r.detail}")
            if reports and all(r.status == "failed" for r in reports):
                print("sync: every feed failed", file=sys.stderr)
                return 1
            print(f"sync: {len(reports)} feeds")
            return 0
        report = run_checks(conn, limit=args.limit)
        print(f"linkcheck: {report.checked} checked, {report.alive} alive, {report.gone} gone ({report.suspect} now suspect, {report.expired} expired), {report.inconclusive} inconclusive")
        return 0


if __name__ == "__main__":
    sys.exit(main())
