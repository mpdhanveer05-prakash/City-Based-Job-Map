"""The same outbound-link rule as the site's lib/links.ts, for the pipeline (P8-01): a careers page a feed reads, and an apply
link a feed supplies, must be https and belong to the company or to a known applicant-tracking host."""
from __future__ import annotations

import urllib.parse

#: Keep in step with KNOWN_ATS_HOSTS in lib/links.ts (a unit test on each side checks the same hosts).
KNOWN_ATS_HOSTS = (
    "greenhouse.io",
    "lever.co",
    "ashbyhq.com",
    "workable.com",
    "smartrecruiters.com",
    "myworkdayjobs.com",
    "recruitee.com",
    "bamboohr.com",
    "breezy.hr",
    "icims.com",
    "jobvite.com",
    "teamtailor.com",
    "zohorecruit.com",
    "freshteam.com",
    "keka.com",
)


def _matches(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def company_owns(url: str, domain: str) -> bool:
    """True when the https URL's host is the company's domain or one of its subdomains."""
    parts = urllib.parse.urlsplit(url)
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and not parts.username and bool(host) and _matches(host, domain.lower().removeprefix("www."))


def acceptable_apply_link(url: str, domain: str) -> bool:
    """The company's own domain, or a known applicant-tracking host."""
    if company_owns(url, domain):
        return True
    parts = urllib.parse.urlsplit(url)
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and not parts.username and any(_matches(host, ats) for ats in KNOWN_ATS_HOSTS)
