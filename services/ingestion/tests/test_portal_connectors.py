"""Portal connector tests (NBS bulletin, UBEC factsheet) — recorded
fixtures only, NO network access."""
from pathlib import Path

import httpx
import pytest

from app.connectors import REGISTRY
from app.connectors.nbs_bulletin import NbsBulletinConnector
from app.connectors.portal import PortalConnector, extract_date, extract_links
from app.connectors.ubec_factsheet import UbecFactsheetConnector
from app.errors import ServiceError

FIXTURES = Path(__file__).parent / "fixtures"


def mock_client(routes: dict[str, object]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        for key, body in routes.items():
            if key in str(request.url):
                status = 200
                payload = body
                if isinstance(body, tuple):
                    status, payload = body
                return httpx.Response(status, content=str(payload))
        return httpx.Response(404, content="not mocked")
    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture(autouse=True)
def _clear_caches():
    PortalConnector.reset_caches()
    yield
    PortalConnector.reset_caches()


# ---------------------------------------------------------------------------
# link/date extraction primitives
# ---------------------------------------------------------------------------
def test_extract_links_resolves_relative_urls():
    html = '<a href="/a/b.pdf">Bulletin</a><a href="https://x.test/c">C</a>'
    links = extract_links(html, "https://portal.test/index")
    assert ("https://portal.test/a/b.pdf", "Bulletin") in links
    assert ("https://x.test/c", "C") in links


def test_extract_date_formats():
    assert extract_date("CPI Bulletin March 2025") == "2025-03-01"
    assert extract_date("Report Q4 2024") == "2024-10-01"
    assert extract_date("GDP Report 2024") == "2024-01-01"
    assert extract_date("Published 2025-03-14") == "2025-03-14"
    assert extract_date("12 February 2025") == "2025-02-12"
    assert extract_date("no date here") is None


# ---------------------------------------------------------------------------
# NBS bulletin connector
# ---------------------------------------------------------------------------
def test_nbs_connector_registered():
    assert "nbs_bulletin" in REGISTRY
    assert "ubec_factsheet" in REGISTRY


def test_nbs_fetch_extracts_latest_bulletins_metadata_only():
    conn = NbsBulletinConnector(client=mock_client({
        "robots.txt": "User-agent: *\nDisallow: /admin\n",
        "nigerianstat.gov.ng/": (FIXTURES / "nbs_index.html").read_text(),
    }))
    raw = conn.fetch("jur:ng-kd", None, {})
    assert len(raw) == 1
    pubs = raw[0].payload["publications"]
    assert len(pubs) == 3  # three PDF bulletin links; press release excluded
    assert pubs[0]["published_on"] == "2025-03-01"  # March 2025 newest
    titles = {p["title"] for p in pubs}
    assert "CPI Bulletin March 2025" in titles
    # provenance on every record
    prov = raw[0].provenance
    assert prov.origin == "live" and prov.source_id == "nbs_portal"
    assert prov.checksum.startswith("sha256:")

    out = conn.normalize(raw)
    assert len(out) == 1
    rec = out[0]
    assert rec.entity == "data_source"
    d = rec.data
    assert d["source_id"] == "nbs_portal"
    assert d["publication_count"] == 3
    assert d["latest_publication_url"].endswith(".pdf")
    # METADATA ONLY: no statistic values anywhere in the record
    assert "value" not in d and "metric_key" not in d
    contract = conn.contract_check(raw, out)
    assert contract.schema_ok and contract.completeness_ok


def test_nbs_robots_disallow_blocks_index():
    conn = NbsBulletinConnector(client=mock_client({
        "robots.txt": "User-agent: *\nDisallow: /\n",
    }))
    with pytest.raises(ServiceError) as exc:
        conn.fetch("jur:ng-kd", None, {})
    assert exc.value.code == "ROBOTS_DISALLOWED"


# ---------------------------------------------------------------------------
# UBEC factsheet connector
# ---------------------------------------------------------------------------
def test_ubec_fetch_extracts_factsheets():
    conn = UbecFactsheetConnector(client=mock_client({
        "robots.txt": "User-agent: *\nDisallow:\n",
        "ubec.gov.ng/": (FIXTURES / "ubec_index.html").read_text(),
    }))
    raw = conn.fetch("jur:ng-kd", None, {})
    pubs = raw[0].payload["publications"]
    assert len(pubs) == 3
    assert pubs[0]["published_on"] == "2024-01-01"  # newest first
    out = conn.normalize(raw)
    d = out[0].data
    assert d["source_id"] == "ubec_portal"
    assert d["latest_publication_title"] == "Basic Education Factsheet 2024"
    assert "value" not in d and "metric_key" not in d


def test_portal_pages_cached_within_ttl():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if "robots" in str(request.url):
            return httpx.Response(200, content="User-agent: *\nDisallow:\n")
        return httpx.Response(200, content=(FIXTURES / "nbs_index.html").read_text())

    conn = NbsBulletinConnector(client=httpx.Client(transport=httpx.MockTransport(handler)))
    conn.fetch("jur:ng-kd", None, {})
    first = calls["n"]
    conn.fetch("jur:ng-kd", None, {})  # second fetch served from cache
    assert calls["n"] == first  # robots + index fetched once each
