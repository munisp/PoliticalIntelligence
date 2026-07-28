"""ING-8: Dagster orchestration tests — run WITHOUT dagster installed by
injecting a fake dagster module (the same duck-typed surface we use)."""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.connectors import REGISTRY
from app.orchestration import dagster_defs as dd
from app.scheduler import DEFAULT_CADENCE_S


# -- fake dagster module -----------------------------------------------------
class FakeDagster:
    def __init__(self):
        self.op_defs = []
        self.job_defs = []
        self.sensor_defs = []

    def op(self, name=None):
        def deco(fn):
            fn.dagster_name = name
            self.op_defs.append(fn)
            return fn
        return deco

    def job(self, name=None):
        def deco(fn):
            fn.dagster_name = name
            self.job_defs.append(fn)
            return fn
        return deco

    def sensor(self, job=None, name=None, minimum_interval_seconds=None):
        def deco(fn):
            fn.dagster_name = name
            fn.dagster_job = job
            fn.dagster_interval = minimum_interval_seconds
            self.sensor_defs.append(fn)
            return fn
        return deco

    class ScheduleDefinition:
        def __init__(self, job=None, cron_schedule=None, name=None):
            self.job = job
            self.cron_schedule = cron_schedule
            self.name = name

    class Definitions:
        def __init__(self, jobs=None, schedules=None, sensors=None):
            self.jobs = jobs or []
            self.schedules = schedules or []
            self.sensors = sensors or []

    class SkipReason(str):
        pass

    class RunRequest:
        def __init__(self, run_key=None, run_config=None):
            self.run_key = run_key
            self.run_config = run_config


# -- cron mapping -------------------------------------------------------------
def test_cron_for_cadence_table():
    assert dd.cron_for_cadence(3600) == "0 * * * *"
    assert dd.cron_for_cadence(86400) == "0 6 * * *"
    assert dd.cron_for_cadence(604800) == "0 6 * * 0"
    assert dd.cron_for_cadence(1800) == "*/30 * * * *"
    assert dd.cron_for_cadence(7200) == "0 */2 * * *"
    with pytest.raises(ValueError):
        dd.cron_for_cadence(0)


def test_schedule_specs_cover_all_connectors_with_cadence():
    specs = dd.schedule_specs()
    names = {s.connector for s in specs}
    assert names == set(DEFAULT_CADENCE_S) == set(REGISTRY)
    by = {s.connector: s for s in specs}
    assert by["worldbank"].cron == "0 6 * * *"        # daily
    assert by["file_harvester"].cron == "0 * * * *"   # hourly
    assert by["nbs_bulletin"].cron == "0 6 * * 0"     # weekly
    assert all(s.name == f"{s.connector}_schedule" for s in specs)


# -- definitions load (mock dagster) ------------------------------------------
def test_build_definitions_with_fake_dagster():
    dg = FakeDagster()
    defs = dd.build_definitions(dg)
    assert len(defs.jobs) == len(REGISTRY) == 9
    assert {s.cron_schedule for s in defs.schedules} == {
        "0 6 * * *", "0 6 * * 0", "0 * * * *", "0 6 */90 * *"
    }
    assert len(defs.schedules) == 9
    assert len(defs.sensors) == 1
    assert defs.sensors[0].dagster_name == "new_data_source_sensor"
    assert defs.sensors[0].dagster_interval == 60


def test_connector_op_runs_pipeline(monkeypatch):
    dg = FakeDagster()
    calls = []
    import app.pipeline as pipeline

    monkeypatch.setattr(
        pipeline, "run_pipeline",
        lambda name: calls.append(name) or {"records": 3},
    )
    op = dd.make_connector_op(dg, "worldbank")
    ctx = SimpleNamespace(log=SimpleNamespace(info=lambda *a, **k: None))
    out = op(ctx)
    assert calls == ["worldbank"]
    assert out["connector"] == "worldbank"
    assert op.dagster_name == "harvest_worldbank"


# -- new-source sensor ---------------------------------------------------------
def test_sensor_detects_new_sources(tmp_path: Path):
    dg = FakeDagster()
    (tmp_path / "budget-2026.csv").write_text("a,b\n1,2\n")
    job = object()
    sensor = dd.make_new_source_sensor(dg, job, sources_dir=tmp_path)
    ctx = SimpleNamespace(
        cursor=None,
        update_cursor=lambda c: setattr(ctx, "cursor", c),
        log=SimpleNamespace(info=lambda *a, **k: None),
    )
    requests = list(sensor(ctx))
    assert len(requests) == 1
    assert "budget-2026.csv" in json.dumps(requests[0].run_config)
    # second tick with persisted cursor -> no run requests (skip)
    assert list(sensor(ctx)) == []


def test_new_sources_diff():
    cur = {"a.csv": "a:10:1", "b.csv": "b:5:1"}
    assert dd.new_sources(cur, None) == ["a.csv", "b.csv"]
    assert dd.new_sources(cur, {"a.csv": "a:10:1", "b.csv": "b:5:1"}) == []
    assert dd.new_sources(cur, {"a.csv": "a:10:1"}) == ["b.csv"]
    changed = {"a.csv": "a:11:2"}
    assert dd.new_sources({**cur, **changed}, cur) == ["a.csv"]


def test_dagster_not_installed_raises():
    with pytest.raises(RuntimeError, match="dagster is not installed"):
        dd.load_dagster()
