"""ING-8: Dagster orchestration for the ingestion connectors.

Wraps the 8 connectors (app.connectors.REGISTRY) as Dagster ops/jobs with
per-pack schedules derived from the refresh cadence (app.scheduler
DEFAULT_CADENCE_S), plus a sensor that fires when new data sources appear
in the watched sources directory (INGESTION_SOURCES_DIR — the file
harvester's drop zone).

dagster is an OPTIONAL extra (requirements-extras.txt). This module is
import-guarded: the pure planning helpers (cron_for_cadence,
schedule_specs) and the op/sensor factories work with any injected
dagster-like module, so unit tests run without dagster installed.

Run for real:
  pip install -r requirements-extras.txt
  DAGSTER_HOME=$(pwd) dagster dev -m app.orchestration.dagster_defs
(dagster.yaml in this service dir configures the instance.)
"""
from __future__ import annotations

import importlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.config import settings
from app.connectors import REGISTRY
from app.logging_setup import get_logger
from app.scheduler import DEFAULT_CADENCE_S

log = get_logger("orchestration.dagster")

SOURCES_DIR = os.getenv(
    "INGESTION_SOURCES_DIR",
    os.path.join(settings.artifacts_dir, "sources"),
)


# ---------------------------------------------------------------------------
# Pure planning (no dagster needed)
# ---------------------------------------------------------------------------
def cron_for_cadence(seconds: int) -> str:
    """Map a refresh cadence (seconds) to a cron expression.

    hourly -> "0 * * * *", daily -> "0 6 * * *", weekly -> "0 6 * * 0",
    sub-hourly -> "*/N * * * *" (minutes), other multiples of an hour ->
    "0 */H * * *". Deterministic; schedules land at minute 0 / 06:00 UTC
    to avoid thundering herds at midnight.
    """
    if seconds <= 0:
        raise ValueError(f"cadence must be positive, got {seconds}")
    hour, day, week = 3600, 86400, 604800
    if seconds < hour:
        return f"*/{max(1, seconds // 60)} * * * *"
    if seconds == hour:
        return "0 * * * *"
    if seconds == day:
        return "0 6 * * *"
    if seconds == week:
        return "0 6 * * 0"
    if seconds % day == 0:
        return f"0 6 */{seconds // day} * *"
    if seconds % hour == 0 and seconds < day:
        return f"0 */{seconds // hour} * * *"
    return f"0 */{max(1, round(seconds / hour))} * * *"


@dataclass(frozen=True)
class ScheduleSpec:
    name: str
    connector: str
    cron: str
    cadence_s: int


def schedule_specs(cadence: dict[str, int] | None = None) -> list[ScheduleSpec]:
    """One schedule per connector, ordered by connector name."""
    cadence = cadence or DEFAULT_CADENCE_S
    return [
        ScheduleSpec(
            name=f"{name}_schedule",
            connector=name,
            cron=cron_for_cadence(cadence[name]),
            cadence_s=cadence[name],
        )
        for name in sorted(cadence)
        if name in REGISTRY
    ]


def scan_sources(sources_dir: str | Path = SOURCES_DIR) -> dict[str, str]:
    """Current source files -> change markers (name:size:mtime). The sensor
    diffs this against its cursor to detect NEW data sources."""
    root = Path(sources_dir)
    if not root.exists():
        return {}
    out: dict[str, str] = {}
    for p in sorted(root.rglob("*")):
        if p.is_file():
            st = p.stat()
            out[p.name] = f"{p.name}:{st.st_size}:{int(st.st_mtime)}"
    return out


def new_sources(current: dict[str, str], cursor: dict[str, str] | None) -> list[str]:
    """Source names that are new or changed relative to the cursor."""
    cursor = cursor or {}
    return sorted(n for n, m in current.items() if cursor.get(n) != m)


# ---------------------------------------------------------------------------
# Dagster wiring (import-guarded)
# ---------------------------------------------------------------------------
def load_dagster():
    """Import dagster or raise a clear error (optional extra)."""
    try:
        return importlib.import_module("dagster")
    except ImportError as exc:
        raise RuntimeError(
            "dagster is not installed — pip install -r "
            "requirements-extras.txt (extra: dagster, dagster-webserver)"
        ) from exc


def make_connector_op(dg: Any, connector_name: str):
    """Build a dagster op that runs one connector through the standard
    pipeline (fetch -> validate -> normalize -> emit/load)."""

    @dg.op(name=f"harvest_{connector_name}")
    def _op(context) -> dict[str, Any]:
        from app.pipeline import run_pipeline

        result = run_pipeline(connector_name)
        context.log.info(
            "harvested %s: %s", connector_name, json.dumps(result, default=str)
        )
        return {"connector": connector_name, "result": result}

    return _op


def make_connector_job(dg: Any, connector_name: str):
    op = make_connector_op(dg, connector_name)

    @dg.job(name=f"{connector_name}_job")
    def _job():
        op()

    return _job


def make_new_source_sensor(dg: Any, file_harvester_job: Any,
                           sources_dir: str | Path = SOURCES_DIR):
    """Sensor: new/changed files in the sources drop zone trigger the
    file_harvester job; the seen-set is kept in the sensor cursor."""

    @dg.sensor(job=file_harvester_job, name="new_data_source_sensor",
               minimum_interval_seconds=60)
    def _sensor(context):
        current = scan_sources(sources_dir)
        cursor = json.loads(context.cursor) if context.cursor else {}
        fresh = new_sources(current, cursor)
        if not fresh:
            return dg.SkipReason("no new data sources")
        context.update_cursor(json.dumps(current))
        context.log.info("new data sources detected: %s", fresh)
        yield dg.RunRequest(
            run_key=f"new-source-{max(current.values())}",
            run_config={
                "ops": {"harvest_file_harvester": {"config": {"only": fresh}}}
            },
        )

    return _sensor


def build_definitions(dg: Any | None = None):
    """Assemble the Dagster Definitions: 8 connector jobs, per-pack
    schedules from the refresh cadence, and the new-source sensor.
    `dg` is injectable for tests (any dagster-like module)."""
    dg = dg or load_dagster()
    jobs = {name: make_connector_job(dg, name) for name in sorted(REGISTRY)}
    schedules = [
        dg.ScheduleDefinition(
            job=jobs[spec.connector], cron_schedule=spec.cron, name=spec.name,
        )
        for spec in schedule_specs()
        if spec.connector in jobs
    ]
    sensors = []
    if "file_harvester" in jobs:
        sensors.append(make_new_source_sensor(dg, jobs["file_harvester"]))
    return dg.Definitions(
        jobs=list(jobs.values()), schedules=schedules, sensors=sensors,
    )


# Module-level Definitions for `dagster dev -m app.orchestration.dagster_defs`.
# Guarded so importing this module never requires dagster.
try:  # pragma: no cover - exercised in the dagster profile, not unit tests
    defs = build_definitions()
except RuntimeError:
    defs = None
    log.warning("dagster not installed — orchestration definitions unavailable")
