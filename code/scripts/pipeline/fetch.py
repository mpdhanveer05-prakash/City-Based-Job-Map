"""Fetching over the network, with the rules a pipeline that follows other people's URLs needs (P8-01, P8-02).

Every URL here comes from the database (a feed's board name, a careers page, a job's apply link), written by an admin or
imported, so each one is treated as untrusted: https only, no credentials in the URL, the host must resolve to a public
address (no localhost, private ranges, or link-local, which is where cloud metadata services live), redirects are
followed a few times and checked the same way, the body is capped, and every request has a timeout. Standard library
only, so the GitHub runner needs no packages for it.

A residual risk: the address is checked when the request is made, and a hostile DNS server could answer differently a
moment later (rebinding). The runner holds no secrets other than the pipeline database login, so the impact is a request
to an internal address that returns nothing the pipeline stores; it is noted in docs/security.md.
"""
from __future__ import annotations

import ipaddress
import socket
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable

MAX_BYTES = 2_000_000
TIMEOUT_SECONDS = 20
MAX_REDIRECTS = 3
USER_AGENT = "CompanyMapBot/1.0 (+job-board indexer; contact the site owner to opt out)"


class FetchError(Exception):
    """The URL was refused or the request failed. `retryable` is true for the network's own failures (a timeout, a 5xx)."""

    def __init__(self, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


@dataclass(frozen=True)
class Response:
    status: int
    final_url: str
    body: str = ""


Resolver = Callable[[str], list[str]]


def _resolve(host: str) -> list[str]:
    try:
        return [info[4][0] for info in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)]
    except socket.gaierror as error:
        raise FetchError(f"cannot resolve {host}: {error}", retryable=True) from error


def check_url(url: str, resolver: Resolver = _resolve) -> str:
    """Raises FetchError unless the URL is https, has no credentials, and its host resolves only to public addresses."""
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https":
        raise FetchError("only https URLs are fetched")
    if parsed.username or parsed.password:
        raise FetchError("a URL with a user name or password is refused")
    host = parsed.hostname
    if not host:
        raise FetchError("the URL has no host")
    for address in resolver(host):
        ip = ipaddress.ip_address(address.split("%")[0])
        if not ip.is_global:
            raise FetchError(f"{host} resolves to a non-public address ({ip}); refused")
    return url


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """We follow redirects ourselves, so each hop can be checked."""

    def redirect_request(self, *args, **kwargs):  # noqa: D401 - urllib's name
        return None


def _open(url: str, method: str, opener: urllib.request.OpenerDirector | None) -> tuple[int, dict[str, str], bytes]:
    request = urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT, "Accept": "application/json, text/html;q=0.9, */*;q=0.1"})
    director = opener or urllib.request.build_opener(_NoRedirect)
    try:
        with director.open(request, timeout=TIMEOUT_SECONDS) as response:
            body = response.read(MAX_BYTES + 1) if method == "GET" else b""
            return response.status, {k.lower(): v for k, v in response.headers.items()}, body
    except urllib.error.HTTPError as error:
        # 3xx (we refuse to follow automatically) and 4xx/5xx arrive here: they are answers, not failures.
        return error.code, {k.lower(): v for k, v in (error.headers or {}).items()}, b""
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise FetchError(f"request failed: {error}", retryable=True) from error


def request(url: str, method: str = "GET", *, resolver: Resolver = _resolve, opener: urllib.request.OpenerDirector | None = None) -> Response:
    """One request, following up to MAX_REDIRECTS redirects that are each checked. Never returns a body over MAX_BYTES."""
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        check_url(current, resolver)
        status, headers, body = _open(current, method, opener)
        if status in (301, 302, 303, 307, 308) and headers.get("location"):
            current = urllib.parse.urljoin(current, headers["location"])
            continue
        if len(body) > MAX_BYTES:
            raise FetchError(f"the response is larger than {MAX_BYTES} bytes")
        return Response(status=status, final_url=current, body=body.decode("utf-8", errors="replace"))
    raise FetchError(f"more than {MAX_REDIRECTS} redirects")


def fetch_text(url: str, *, resolver: Resolver = _resolve, opener: urllib.request.OpenerDirector | None = None) -> str:
    """The body of a successful GET. A 4xx or 5xx raises FetchError (5xx and 429 are marked retryable)."""
    response = request(url, "GET", resolver=resolver, opener=opener)
    if response.status != 200:
        raise FetchError(f"HTTP {response.status}", retryable=response.status >= 500 or response.status == 429)
    return response.body
