"""Scheduler tests — cadence due logic, jitter, state persistence, loop guard."""
from __future__ import annotations

import json
import random
from datetime import datetime, timezone
from pathlib import Path

from app import scheduler


def test_due_connectors_never_run_are_due_immediately():
    due = scheduler.due_connectors(
        now=1_000_000.0,
        state={},
        cadence={"worldbank": 86400, "nbs_bulletin": 7 * 86400},
        rng=random.Random(42),
    )
    assert {name for name, _ in due} == {"worldbank", "nbs_bulletin"}


def test_due_connectors_respects_interval():
    now = 1_000_000.0
    state = {"worldbank": datetime.fromtimestamp(now - 3600, tz=timezone.utc).isoformat()}
    due = scheduler.due_connectors(
        now=now, state=state, cadence={"worldbank": 86400}, rng=random.Random(1)
    )
    assert due == []  # ran 1h ago on a 24h cadence
    state = {"worldbank": datetime.fromtimestamp(now - 90000, tz=timezone.utc).isoformat()}
    due = scheduler.due_connectors(
        now=now, state=state, cadence={"worldbank": 86400}, rng=random.Random(1)
    )
    assert [n for n, _ in due] == ["worldbank"]


def test_jitter_stays_within_band():
    now = 1_000_000.0
    interval = 86400
    last = now - 86400 * 1.05  # 5% past the plain interval
    state = {"worldbank": datetime.fromtimestamp(last, tz=timezone.utc).isoformat()}
    fires = []
    for seed in range(50):
        due = scheduler.due_connectors(
            now=now, state=state, cadence={"worldbank": interval},
            jitter_pct=0.10, rng=random.Random(seed),
        )
        fires.extend(f for _, f in due)
        if due:
            fire = due[0][1]
            assert abs(fire - (last + interval)) <= interval * 0.10 + 1e-6
    assert fires  # 5% overdue -> due for most jitter draws


def test_unknown_connector_in_cadence_is_skipped():
    due = scheduler.due_connectors(
        now=1.0, state={}, cadence={"ghost_connector": 10}, rng=random.Random(0)
    )
    assert due == []


def test_state_roundtrip(tmp_path: Path):
    path = tmp_path / "state.json"
    scheduler.save_state({"worldbank": "2025-01-01T00:00:00+00:00"}, path)
    assert scheduler.load_state(path)["worldbank"].startswith("2025-01-01")
    assert scheduler.load_state(tmp_path / "missing.json") == {}


def test_run_due_once_runs_only_due_and_persists(tmp_path: Path):
    ran: list[str] = []
    now = 1_000_000.0

    def fake_runner(connector, jurisdiction, since, params, producer, artifacts_dir):
        ran.append(connector.name)
        return {"records_out": 3}

    fresh = datetime.fromtimestamp(now, tz=timezone.utc).isoformat()
    state = scheduler.run_due_once(
        now=now,
        state={"hdx": fresh},  # hdx ran just now on a 24h cadence
        cadence={"worldbank": 86400, "hdx": 86400},
        rng=random.Random(7),
        state_path=tmp_path / "state.json",
        runner=fake_runner,
    )
    assert ran == ["worldbank"]  # only the due connector ran
    assert state["worldbank"] == datetime.fromtimestamp(
        now, tz=timezone.utc
    ).isoformat()
    persisted = json.loads((tmp_path / "state.json").read_text())
    assert persisted == state


def test_run_due_once_connector_failure_does_not_stop_others(tmp_path: Path):
    ran: list[str] = []

    def flaky_runner(connector, jurisdiction, since, params, producer, artifacts_dir):
        ran.append(connector.name)
        if connector.name == "worldbank":
            raise RuntimeError("portal down")
        return {"records_out": 1}

    state = scheduler.run_due_once(
        now=1_000_000.0,
        state={},
        cadence={"worldbank": 10, "hdx": 10},
        rng=random.Random(0),
        state_path=tmp_path / "state.json",
        runner=flaky_runner,
    )
    assert sorted(ran) == ["hdx", "worldbank"]
    assert "hdx" in state  # success persisted
    assert "worldbank" not in state  # failure -> still due next tick


def test_main_noop_when_disabled(monkeypatch, caplog):
    monkeypatch.setenv("SCHEDULER_ENABLED", "0")
    scheduler.main()  # returns immediately, does not enter the loop


def test_cadence_config_env_override(monkeypatch):
    monkeypatch.setenv("SCHEDULER_CADENCE", '{"worldbank": 60}')
    assert scheduler.cadence_config() == {"worldbank": 60}
    monkeypatch.setenv("SCHEDULER_CADENCE", "not json")
    assert scheduler.cadence_config() == scheduler.DEFAULT_CADENCE_S
