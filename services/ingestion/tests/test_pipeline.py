"""Pipeline tests: dedupe, JSONL artifacts, event emission, contract gating."""
import json
from pathlib import Path

from app import events
from app.connectors.worldbank import WorldBankConnector
from app.models import CanonicalRecord, Provenance
from app.pipeline import dedupe, run_pipeline
from tests.test_connectors import load, mock_client


class CaptureProducer:
    def __init__(self):
        self.sent = []

    def send(self, topic, payload):
        self.sent.append((topic, payload))


def _prov():
    return Provenance(origin="live", source_id="test", url="https://x")


def test_dedupe_removes_exact_duplicate_metrics():
    data = {"jurisdiction_id": "NGA", "sector_code": "economy",
            "metric_key": "gdp_growth", "value": 3.3, "period": "2023"}
    recs = [CanonicalRecord(entity="sector_metric", data=data, provenance=_prov())
            for _ in range(3)]
    assert len(dedupe(recs)) == 1


def test_dedupe_keeps_distinct_periods():
    recs = [
        CanonicalRecord(entity="sector_metric",
                        data={"jurisdiction_id": "NGA", "sector_code": "economy",
                              "metric_key": "gdp_growth", "value": v,
                              "period": p},
                        provenance=_prov())
        for v, p in ((3.3, "2023"), (4.3, "2022"))
    ]
    assert len(dedupe(recs)) == 2


def test_pipeline_end_to_end_writes_jsonl_and_events(tmp_path):
    conn = WorldBankConnector(client=mock_client(
        {"SP.POP.TOTL": load("worldbank_nga_pop.json")}))
    producer = CaptureProducer()
    summary = run_pipeline(
        conn, "nga", "2021",
        {"country_iso3": "NGA", "indicators": ["SP.POP.TOTL"]},
        producer=producer, artifacts_dir=str(tmp_path),
    )
    assert summary["records_in"] == 1
    assert summary["records_out"] == 3
    artifact = Path(summary["artifact"])
    assert artifact.parent == tmp_path / "worldbank"
    lines = artifact.read_text().strip().splitlines()
    assert len(lines) == 3
    record = json.loads(lines[0])
    assert record["entity"] == "sector_metric"
    assert record["provenance"]["origin"] == "live"
    assert record["provenance"]["checksum"].startswith("sha256:")
    topics = [t for t, _ in producer.sent]
    assert topics == [events.TOPIC_INGEST_RAW, events.TOPIC_FEATURES_MATERIALIZED]
    assert producer.sent[1][1]["records_out"] == 3


def test_pipeline_is_deterministic_for_same_input(tmp_path):
    def run_once(sub):
        conn = WorldBankConnector(client=mock_client(
            {"SP.POP.TOTL": load("worldbank_nga_pop.json")}))
        return run_pipeline(conn, "nga", None,
                            {"indicators": ["SP.POP.TOTL"]},
                            producer=CaptureProducer(),
                            artifacts_dir=str(tmp_path / sub))
    a, b = run_once("a"), run_once("b")
    def strip_ts(path):
        out = []
        for line in Path(path).read_text().splitlines():
            rec = json.loads(line)
            rec["provenance"].pop("fetched_at")  # wall-clock by design
            out.append(rec)
        return out
    assert strip_ts(a["artifact"]) == strip_ts(b["artifact"])


def test_noop_producer_logs(caplog):
    import logging
    p = events.build_producer(brokers="")
    with caplog.at_level(logging.INFO, logger="ingestion.events"):
        p.send("ingest.raw.received", {"records_in": 1})
    assert "ingest.raw.received" in caplog.text
