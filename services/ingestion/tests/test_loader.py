"""Loader tests (mocked platform API): batching, wire shape, provenance,
per-entity counts, error recording, idempotent replay outcome."""
import json

import pytest

from app import loader
from app.models import CanonicalRecord, Provenance


def _rec(entity="sector_metric", data=None, period="2023"):
    return CanonicalRecord(
        entity=entity,
        data=data
        or {
            "jurisdiction_id": "NGA",
            "sector_code": "economy",
            "metric_key": "gdp_growth",
            "value": 3.3,
            "period": period,
            "confidence": 0.95,
        },
        provenance=Provenance(
            origin="live",
            source_id="worldbank_api",
            url="https://api.worldbank.org/v2/x",
            checksum="sha256:abc",
        ),
    )


class FakeResponse:
    def __init__(self, counts, records=1):
        self._body = json.dumps(
            {
                "result": {
                    "data": {
                        "json": {
                            "data": {"records": records, "counts": counts},
                            "meta": {},
                            "audit": {},
                        }
                    }
                }
            }
        ).encode()

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def api(monkeypatch):
    """Capture urlopen calls; respond with canned counts."""
    calls = []

    def fake_urlopen(req, timeout=0):
        body = json.loads(req.data)
        calls.append({"url": req.full_url, "headers": dict(req.headers), "body": body})
        key = next(k for k in body["json"] if k != "jurisdiction_id")
        n = len(body["json"][key])
        return FakeResponse(
            {key: {"inserted": n, "updated": 0, "errors": 0}, "error_messages": []},
            records=n,
        )

    monkeypatch.setattr(loader.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setenv("LOADER_API_KEY", "test-key")
    monkeypatch.setenv("PLATFORM_API_URL", "http://platform.test")
    return calls


def test_posts_trpc_superjson_wire_shape_with_loader_key(api):
    loader.load_canonical([_rec()], "ng-kd")
    assert len(api) == 1
    call = api[0]
    assert call["url"] == "http://platform.test/api/trpc/jurisdictions.loadCanonical"
    assert call["headers"].get("X-loader-key") == "test-key"
    payload = call["body"]["json"]
    assert payload["jurisdiction_id"] == "ng-kd"
    rec = payload["sector_metrics"][0]
    assert rec["provenance"]["origin"] == "live"
    assert rec["provenance"]["source_id"] == "worldbank_api"


def test_run_jurisdiction_overrides_source_system_id(api):
    loader.load_canonical([_rec()], "ng-kd")
    rec = api[0]["body"]["json"]["sector_metrics"][0]
    assert rec["data"]["jurisdiction_id"] == "ng-kd"


def test_batches_at_500_records(api):
    recs = [_rec(period=str(2000 + i)) for i in range(1100)]
    outcome = loader.load_canonical(recs, "ng-kd")
    assert outcome["batches"] == 3
    assert max(len(c["body"]["json"]["sector_metrics"]) for c in api) == 500
    assert outcome["entities"]["sector_metrics"]["inserted"] == 1100


def test_groups_records_by_entity(api):
    recs = [
        _rec(),
        _rec("facility", {"jurisdiction_id": "NGA", "name": "PHC", "type": "clinic"}),
        _rec("jurisdiction", {"id": "ng-kd"}),  # not loadable -> skipped
    ]
    outcome = loader.load_canonical(recs, "ng-kd")
    assert outcome["entities"]["sector_metrics"]["records"] == 1
    assert outcome["entities"]["facilities"]["records"] == 1
    assert outcome["skipped_entities"] == 1


def test_missing_api_key_skips_without_network(monkeypatch):
    monkeypatch.delenv("LOADER_API_KEY", raising=False)
    outcome = loader.load_canonical([_rec()], "ng-kd")
    assert outcome["status"] == "skipped"
    assert outcome["entities"]["sector_metrics"]["records"] == 1


def test_http_errors_are_recorded_not_raised(monkeypatch):
    def boom(req, timeout=0):
        raise OSError("connection refused")

    monkeypatch.setattr(loader.urllib.request, "urlopen", boom)
    monkeypatch.setenv("LOADER_API_KEY", "test-key")
    outcome = loader.load_canonical([_rec()], "ng-kd")
    assert outcome["status"] == "partial"
    assert outcome["entities"]["sector_metrics"]["errors"] == 1
    assert "connection refused" in outcome["error_messages"][0]


def test_replay_reports_updates_not_inserts(monkeypatch):
    """Second identical run: API reports updates (idempotent replay)."""
    monkeypatch.setenv("LOADER_API_KEY", "test-key")

    def replay(req, timeout=0):
        body = json.loads(req.data)
        key = next(k for k in body["json"] if k != "jurisdiction_id")
        n = len(body["json"][key])
        return FakeResponse(
            {key: {"inserted": 0, "updated": n, "errors": 0}, "error_messages": []},
            records=n,
        )

    monkeypatch.setattr(loader.urllib.request, "urlopen", replay)
    outcome = loader.load_canonical([_rec(), _rec(period="2022")], "ng-kd")
    ent = outcome["entities"]["sector_metrics"]
    assert ent["inserted"] == 0
    assert ent["updated"] == 2
    assert outcome["status"] == "ok"
