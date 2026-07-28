"""DM-4: lakehouse export pipeline tests.

All tests run WITHOUT pyiceberg — the table writer is mocked/JSONL. A real
PyIceberg round-trip test is marked skip-if-no-pyiceberg.
"""
from __future__ import annotations

import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.lakehouse import (
    TABLES,
    LocalJsonlWriter,
    apply_watermark,
    export_entity,
    map_record,
    plan_export,
)
from app.lakehouse.__main__ import main as cli_main

HAS_PYICEBERG = importlib.util.find_spec("pyiceberg") is not None


def metric_row(i: int, updated: str) -> dict:
    return {
        "metric_id": f"met:{i}",
        "jurisdiction_id": "jur:ng-kd",
        "sector_code": "agriculture",
        "indicator": "gdp_share",
        "value": 12.5 + i,
        "unit": "percent",
        "period": "2024",
        "updated_at": updated,
        "source_id": "src:worldbank",
        "ingested_at": updated,
        "extra_column_dropped": "x",
    }


class RecordingWriter:
    def __init__(self):
        self.calls = []

    def write(self, namespace, table, schema, records):
        self.calls.append((namespace, table, schema, records))
        return len(records)


def test_all_ten_canonical_entities_have_schemas():
    assert set(TABLES) == {
        "jurisdictions", "sector_metrics", "opportunities", "laws",
        "clauses", "simulation_runs", "evidence_sources", "budgets",
        "facilities", "procurement_records",
    }
    for s in TABLES.values():
        assert any(c.name == "updated_at" and c.required for c in s.columns)
        assert any(c.required for c in s.columns)  # natural key


def test_map_record_projects_schema_and_drops_extras():
    rec = map_record(TABLES["sector_metrics"], metric_row(1, "2026-01-01T00:00:00Z"))
    assert rec["metric_id"] == "met:1"
    assert "extra_column_dropped" not in rec
    assert set(rec) == set(TABLES["sector_metrics"].column_names)


def test_map_record_datetime_normalized_to_iso():
    row = metric_row(2, "2026-01-01")
    row["updated_at"] = datetime(2026, 1, 2, tzinfo=timezone.utc)
    rec = map_record(TABLES["sector_metrics"], row)
    assert rec["updated_at"] == "2026-01-02T00:00:00+00:00"


def test_map_record_missing_required_raises():
    with pytest.raises(ValueError):
        map_record(TABLES["sector_metrics"], {"sector_code": "x"})


def test_plan_export_full_when_no_watermark():
    plan = plan_export("sector_metrics", {})
    assert plan.full is True and plan.since is None
    assert plan.table == "sector_metrics"
    assert plan.partition_by == ("sector_code",)


def test_plan_export_incremental_from_watermark():
    state = {"sector_metrics": "2026-01-01T00:00:00Z"}
    plan = plan_export("sector_metrics", state)
    assert plan.full is False
    assert plan.since == "2026-01-01T00:00:00Z"
    assert plan.watermark_column == "updated_at"


def test_plan_export_unknown_entity():
    with pytest.raises(KeyError):
        plan_export("nope", {})


def test_apply_watermark_advances_to_max_updated_at():
    state = {"sector_metrics": "2026-01-01T00:00:00Z"}
    plan = plan_export("sector_metrics", state)
    new = apply_watermark(state, plan, [
        {"updated_at": "2026-01-03T00:00:00Z"},
        {"updated_at": "2026-01-02T00:00:00Z"},
    ])
    assert new["sector_metrics"] == "2026-01-03T00:00:00Z"
    # never regresses
    newer = apply_watermark(new, plan, [{"updated_at": "2026-01-01T12:00:00Z"}])
    assert newer["sector_metrics"] == "2026-01-03T00:00:00Z"


def test_export_entity_filters_by_watermark_and_persists(tmp_path: Path):
    writer = RecordingWriter()
    state_path = tmp_path / "state.json"
    state_path.write_text(json.dumps({"sector_metrics": "2026-01-02T00:00:00Z"}))
    rows = [
        metric_row(1, "2026-01-01T00:00:00Z"),  # before watermark -> skipped
        metric_row(2, "2026-01-03T00:00:00Z"),  # exported
        metric_row(3, "2026-01-04T00:00:00Z"),  # exported
    ]
    result = export_entity(
        "sector_metrics", rows, writer=writer, state_path=state_path
    )
    assert result.rows == 2
    ns, table, schema, records = writer.calls[0]
    assert (ns, table) == ("policy_twin", "sector_metrics")
    assert [r["metric_id"] for r in records] == ["met:2", "met:3"]
    # watermark advanced to max exported
    saved = json.loads(state_path.read_text())
    assert saved["sector_metrics"] == "2026-01-04T00:00:00Z"


def test_export_entity_no_new_rows_writes_nothing(tmp_path: Path):
    writer = RecordingWriter()
    state = {"sector_metrics": "2026-01-05T00:00:00Z"}
    result = export_entity(
        "sector_metrics",
        [metric_row(1, "2026-01-01T00:00:00Z")],
        writer=writer,
        state=state,
        persist_state=False,
    )
    assert result.rows == 0
    assert writer.calls == []


def test_export_entity_full_ignores_watermark(tmp_path: Path):
    writer = RecordingWriter()
    result = export_entity(
        "sector_metrics",
        [metric_row(1, "2026-01-01T00:00:00Z")],
        writer=writer,
        full=True,
        state={"sector_metrics": "2026-02-01T00:00:00Z"},
        persist_state=False,
    )
    assert result.rows == 1
    assert result.plan.full is True


def test_local_jsonl_writer_partitioned_layout(tmp_path: Path):
    writer = LocalJsonlWriter(root=tmp_path)
    n = writer.write(
        "policy_twin", "sector_metrics", TABLES["sector_metrics"],
        [map_record(TABLES["sector_metrics"], metric_row(1, "2026-01-01T00:00:00Z"))],
    )
    assert n == 1
    files = list((tmp_path / "policy_twin" / "sector_metrics").glob("part-*.jsonl"))
    assert len(files) == 1
    line = json.loads(files[0].read_text().strip())
    assert line["metric_id"] == "met:1"


def test_cli_dry_run(tmp_path: Path, capsys):
    src = tmp_path / "metrics.jsonl"
    src.write_text("\n".join(
        json.dumps(metric_row(i, f"2026-01-0{i+1}T00:00:00Z")) for i in range(3)
    ))
    rc = cli_main([
        "export", "--entity", "sector_metrics",
        "--source-jsonl", str(src), "--dry-run",
    ])
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    assert out["table"] == "policy_twin.sector_metrics"
    assert out["candidate_rows"] == 3
    assert out["partition_by"] == ["sector_code"]


def test_cli_export_with_jsonl_writer(tmp_path: Path, capsys, monkeypatch):
    monkeypatch.setenv("LAKEHOUSE_WAREHOUSE", f"file://{tmp_path}")
    monkeypatch.setenv("LAKEHOUSE_STATE_FILE", str(tmp_path / "state.json"))
    src = tmp_path / "metrics.jsonl"
    src.write_text(json.dumps(metric_row(1, "2026-01-01T00:00:00Z")))
    rc = cli_main(["export", "--entity", "sector_metrics", "--source-jsonl", str(src)])
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    assert out["rows_exported"] == 1


@pytest.mark.skipif(not HAS_PYICEBERG, reason="pyiceberg optional extra not installed")
def test_pyiceberg_sql_catalog_roundtrip(tmp_path: Path, monkeypatch):
    """Integration: real Iceberg table via a local sqlite catalog + file
    warehouse (pyiceberg[sql-sqlite] extra)."""
    monkeypatch.setenv("LAKEHOUSE_CATALOG", "sql")
    monkeypatch.setenv("LAKEHOUSE_CATALOG_DB", str(tmp_path / "catalog.db"))
    monkeypatch.setenv("LAKEHOUSE_WAREHOUSE", f"file://{tmp_path}/warehouse")
    from app.lakehouse.exporter import PyIcebergWriter

    writer = PyIcebergWriter()
    n = writer.write(
        "policy_twin", "sector_metrics", TABLES["sector_metrics"],
        [map_record(TABLES["sector_metrics"], metric_row(1, "2026-01-01T00:00:00Z"))],
    )
    assert n == 1
    assert (tmp_path / "warehouse").exists()
