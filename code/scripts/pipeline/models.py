"""What the pipeline reads from a feed and what it decides to do about it (P8-01, P8-02)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class FeedJob:
    """One job as a feed lists it. Only what the site shows or needs to find duplicates."""

    external_ref: str
    title: str
    apply_url: str
    #: Free text from the feed ("Bengaluru, India"); used only to decide which cities list the job.
    location: str
    remote: bool = False
    work_mode: str | None = None
    posted_at: date | None = None


@dataclass(frozen=True)
class ParseResult:
    jobs: list[FeedJob]
    #: Entries the feed had that were left out (no title, no https link, no id...). Counted, never silently lost.
    skipped: int = 0


class FeedError(Exception):
    """A feed answered, but not with something this pipeline can read. The run reports it and changes nothing."""
