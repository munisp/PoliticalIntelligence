"""Per-pack refresh cadence scheduler (SR-1 continuous ingestion).

Runs each connector on its own cadence with jitter, persisting last-run
timestamps so restarts do not re-fire every pack at once.

  SCHEDULER_ENABLED=1            master switch (default OFF — API container
                                 does not schedule; the compose
                                 `ingestion-scheduler` service sets it)
  SCHEDULER_CADENCE              JSON {connector: interval_seconds} override
  SCHEDULER_JITTER_PCT           jitter band, default 0.10 (±10%)
  SCHEDULER_STATE_FILE           last-run persistence path
                                 (default <artifacts_dir>/scheduler-state.json)
  SCHEDULER_TICK_S               loop wake interval (default 60)

Determinism for tests: `due_connectors()` is a pure function of (now,
state, cadence) and jitter is injectable.
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import time
from datetime import datetime, timezone
from pathlib import Path

from app import events
from app.config import settings
from app.connectors import REGISTRY, get_connector
from app.logging_setup import get_logger
from app.pipeline import run_pipeline

log = get_logger("scheduler")

# Default cadence per connector (seconds). PORTAL-class connectors poll
# weekly; API statistics daily; procurement daily; file harvest hourly.
DEFAULT_CADENCE_S: dict[str, int] = {
    "worldbank": 24 * 3600,
    "hdx": 24 * 3600,
    "overpass": 7 * 24 * 3600,
    "nada": 7 * 24 * 3600,
    "budeshi": 24 * 3600,
    "file_harvester": 3600,
    "nbs_bulletin": 7 * 24 * 3600,
    "ubec_factsheet": 7 * 24 * 3600,
    "nbs_outcomes": 90 * 24 * 3600,
    "budget_office": 90 * 24 * 3600,   # quarterly budget publications
    "nass_bills": 7 * 24 * 3600,       # weekly bills tracker
}
DEFAULT_JITTER_PCT = 0.10
DEFAULT_JURISDICTION = "jur:ng-kd"


def cadence_config() -> dict[str, int]:
    raw = os.getenv("SCHEDULER_CADENCE")
    if raw:
        try:
            parsed = json.loads(raw)
            return {str(k): int(v) for k, v in parsed.items()}
        except (ValueError, TypeError):
            log.error("SCHEDULER_CADENCE is not valid JSON — using defaults")
    return dict(DEFAULT_CADENCE_S)


def state_file() -> Path:
    return Path(
        os.getenv(
            "SCHEDULER_STATE_FILE",
            os.path.join(settings.artifacts_dir, "scheduler-state.json"),
        )
    )


def load_state(path: Path | None = None) -> dict[str, str]:
    """Last successful run per connector (ISO timestamps)."""
    p = path or state_file()
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return {}


def save_state(state: dict[str, str], path: Path | None = None) -> None:
    p = path or state_file()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True))
    tmp.replace(p)  # atomic


def due_connectors(
    now: float,
    state: dict[str, str],
    cadence: dict[str, int],
    jitter_pct: float = DEFAULT_JITTER_PCT,
    rng: random.Random | None = None,
) -> list[tuple[str, float]]:
    """Connectors due for a run, each with its jittered fire time <= now.

    A connector is due when `last_run + interval * (1 ± jitter) <= now`.
    Never-run connectors are due immediately. Returns [(name, fire_at)].
    """
    rng = rng or random.Random()
    out: list[tuple[str, float]] = []
    for name, interval in cadence.items():
        if name not in REGISTRY:
            log.warning("cadence configured for unknown connector %s — skipped", name)
            continue
        last_iso = state.get(name)
        last_ts = -1.0
        if last_iso:
            try:
                last_ts = datetime.fromisoformat(last_iso).timestamp()
            except ValueError:
                last_ts = -1.0
        jitter = 1.0 + rng.uniform(-jitter_pct, jitter_pct)
        fire_at = last_ts + interval * jitter
        if fire_at <= now:
            out.append((name, fire_at))
    return out


def run_due_once(
    now: float | None = None,
    state: dict[str, str] | None = None,
    cadence: dict[str, int] | None = None,
    jitter_pct: float = DEFAULT_JITTER_PCT,
    rng: random.Random | None = None,
    producer=None,
    state_path: Path | None = None,
    runner=run_pipeline,
) -> dict[str, str]:
    """Run every due connector once; persist last-run state. Returns state."""
    now = now if now is not None else time.time()
    state = dict(state if state is not None else load_state(state_path))
    cadence = cadence or cadence_config()
    for name, _fire_at in due_connectors(now, state, cadence, jitter_pct, rng):
        log.info("scheduler: running connector %s", name)
        try:
            summary = runner(
                get_connector(name),
                DEFAULT_JURISDICTION,
                None,
                {},
                producer or events.build_producer(),
                settings.artifacts_dir,
            )
            state[name] = datetime.fromtimestamp(now, tz=timezone.utc).isoformat()
            log.info(
                "scheduler: %s ok records_out=%s", name, summary["records_out"]
            )
        except Exception as exc:  # one pack's failure must not stop others
            log.exception("scheduler: connector %s failed: %s", name, exc)
    save_state(state, state_path)
    return state


async def scheduler_loop(tick_s: float | None = None) -> None:
    tick = tick_s or float(os.getenv("SCHEDULER_TICK_S", "60"))
    log.info(
        "scheduler loop started (tick=%ss, cadence=%s)", tick, cadence_config()
    )
    while True:
        await asyncio.to_thread(run_due_once)
        await asyncio.sleep(tick)


def main() -> None:
    if os.getenv("SCHEDULER_ENABLED", "0") not in ("1", "true", "yes"):
        log.info("SCHEDULER_ENABLED is not set — scheduler exits (no-op)")
        return
    asyncio.run(scheduler_loop())


if __name__ == "__main__":
    main()
