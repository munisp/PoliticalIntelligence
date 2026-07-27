"""Shared plumbing for PORTAL-class connectors (publication index pages).

These connectors are honest METADATA collectors: they fetch an official
portal's publication index page, extract links to the latest bulletins /
factsheets plus their publication dates, and emit `data_source` catalog /
freshness records. They NEVER fabricate statistics — indicator values come
only from API-class connectors (worldbank, hdx, ...) or licensed downloads
handled out-of-band.

Politesse + caching:
  - robots.txt is fetched once per portal per process and honored
    (ROBOTS_DISALLOWED error when the index path is excluded);
  - fetched pages are cached in-process for `cache_ttl_s` so a scheduler
    tick does not hammer the portal.
"""
from __future__ import annotations

import re
import time
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpx

from app.config import settings
from app.errors import ServiceError
from app.connectors.base import BaseConnector

_CACHE: dict[str, tuple[float, str]] = {}
_ROBOTS: dict[str, tuple[float, list[str]]] = {}


class _LinkParser(HTMLParser):
    """Collect <a href> + anchor text."""

    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            self._href = dict(attrs).get("href")
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._href is not None:
            self.links.append((self._href, " ".join(self._text).strip()))
            self._href = None
            self._text = []


def extract_links(html: str, base_url: str) -> list[tuple[str, str]]:
    """Return [(absolute_url, anchor_text)] for all anchors."""
    parser = _LinkParser()
    parser.feed(html)
    return [(urljoin(base_url, href), text) for href, text in parser.links if href]


_DATE_PATTERNS = [
    re.compile(r"\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b"),
    re.compile(r"\b(0?[1-9]|[12]\d|3[01])\s+([A-Za-z]+)\s*,?\s+(20\d{2})\b"),
    re.compile(r"\b([A-Za-z]+)\s+(20\d{2})\b"),  # "March 2025"
    re.compile(r"\b(Q[1-4])\s*(20\d{2})\b"),
    re.compile(r"\b(20\d{2})\b"),
]
_MONTHS = {m.lower(): i + 1 for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"])}


def extract_date(text: str) -> str | None:
    """Best-effort publication date (ISO) from link text/title."""
    for pat in _DATE_PATTERNS:
        m = pat.search(text)
        if not m:
            continue
        g = m.groups()
        try:
            if len(g) == 3 and g[1].isdigit():
                return f"{int(g[0]):04d}-{int(g[1]):02d}-{int(g[2]):02d}"
            if len(g) == 3 and g[1].lower() in _MONTHS:
                return f"{int(g[2]):04d}-{_MONTHS[g[1].lower()]:02d}-{int(g[0]):02d}"
            if len(g) == 2 and g[0].lower() in _MONTHS:
                return f"{int(g[1]):04d}-{_MONTHS[g[0].lower()]:02d}-01"
            if len(g) == 2 and g[0].startswith("Q"):
                quarter_month = (int(g[0][1]) - 1) * 3 + 1
                return f"{int(g[1]):04d}-{quarter_month:02d}-01"
            if len(g) == 1:
                return f"{int(g[0]):04d}-01-01"
        except (ValueError, KeyError):
            continue
    return None


class PortalConnector(BaseConnector):
    """Base for publication-index portals (NBS bulletins, UBEC factsheets)."""

    index_url: str = ""
    cache_ttl_s: int = 3600
    #: substrings (lowercase) that mark a link as a publication of interest
    publication_markers: tuple[str, ...] = (".pdf",)

    # -- politeness ---------------------------------------------------------
    def _robots_disallows(self, base: str) -> list[str]:
        now = time.time()
        cached = _ROBOTS.get(base)
        if cached and now - cached[0] < self.cache_ttl_s:
            return cached[1]
        disallows: list[str] = []
        try:
            resp = self.client.get(f"{base}/robots.txt")
            if resp.status_code == 200:
                applies = False
                for line in resp.text.splitlines():
                    line = line.strip()
                    low = line.lower()
                    if low.startswith("user-agent:"):
                        ua = low.split(":", 1)[1].strip()
                        applies = ua == "*" or ua in settings.user_agent.lower()
                    elif applies and low.startswith("disallow:"):
                        path = low.split(":", 1)[1].strip()
                        if path:
                            disallows.append(path)
        except httpx.HTTPError:
            # robots unreachable -> proceed (standard crawler practice).
            disallows = []
        _ROBOTS[base] = (now, disallows)
        return disallows

    def _check_robots(self, url: str) -> None:
        parsed = urlparse(url)
        base = f"{parsed.scheme}://{parsed.netloc}"
        path = parsed.path or "/"
        for rule in self._robots_disallows(base):
            if path.startswith(rule):
                raise ServiceError(
                    code="ROBOTS_DISALLOWED",
                    message=f"{self.name}: {url} excluded by robots.txt ({rule})",
                    http_status=403,
                    retryable=False,
                )

    # -- fetch ---------------------------------------------------------------
    def get_page(self, url: str) -> str:
        now = time.time()
        cached = _CACHE.get(url)
        if cached and now - cached[0] < self.cache_ttl_s:
            return cached[1]
        self._check_robots(url)
        try:
            resp = self.client.get(url)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise ServiceError(
                code="SOURCE_FETCH_FAILED",
                message=f"{self.name}: GET {url} failed: {exc}",
                http_status=502,
                retryable=True,
            ) from exc
        _CACHE[url] = (now, resp.text)
        return resp.text

    # -- extraction -----------------------------------------------------------
    def extract_publications(self, html: str) -> list[dict]:
        """Latest bulletin links + publication dates from an index page."""
        pubs: list[dict] = []
        for url, text in extract_links(html, self.index_url):
            haystack = f"{text} {url}".lower()
            if not any(m in haystack for m in self.publication_markers):
                continue
            title = text or url.rsplit("/", 1)[-1]
            pubs.append({
                "title": title[:500],
                "url": url,
                "published_on": extract_date(f"{text} {url}"),
            })
        # Newest first; undated publications last, stable.
        pubs.sort(key=lambda p: p["published_on"] or "", reverse=True)
        return pubs

    @classmethod
    def reset_caches(cls) -> None:
        _CACHE.clear()
        _ROBOTS.clear()
