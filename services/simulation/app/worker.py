"""Async job lifecycle: queue + asyncio workers + idempotency (no Celery)."""
from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from datetime import datetime, timezone

from app.config import settings
from app.engines import (EngineContext, resolve_assumptions,
                         resolve_jurisdiction, run_engine)
from app.errors import EngineExecutionError, NotFoundError, QueueFullError
from app.logging_setup import get_logger
from app.models import (ArtifactRef, EngineResult, RunStatus, ScenarioConfig,
                        ScenarioRun, TERMINAL_STATES)
from app.storage import ArtifactStore
from app.twin import TwinRegistry

log = get_logger("worker")


class RunManager:
    """Owns the run registry, idempotency map and the asyncio worker pool."""

    def __init__(self, store: ArtifactStore | None = None,
                 twin_registry: TwinRegistry | None = None):
        self.store = store or ArtifactStore()
        self.twins = twin_registry or TwinRegistry(self.store)
        self._runs: dict[str, ScenarioRun] = {}
        self._idempotency: dict[str, str] = {}  # key -> run_id
        self._cancel_flags: dict[str, asyncio.Event] = {}
        self._queue: asyncio.Queue[str] | None = None
        self._workers: list[asyncio.Task] = []
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # lifecycle
    # ------------------------------------------------------------------
    async def start(self) -> None:
        if self._queue is not None:
            return
        self._queue = asyncio.Queue(maxsize=settings.max_queue_size)
        for i in range(settings.worker_count):
            self._workers.append(asyncio.create_task(self._worker(i)))
        log.info(f"started {settings.worker_count} workers")

    async def stop(self) -> None:
        for task in self._workers:
            task.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()
        self._queue = None

    # ------------------------------------------------------------------
    # API surface
    # ------------------------------------------------------------------
    async def create_run(self, config: ScenarioConfig,
                         idempotency_key: str | None) -> tuple[ScenarioRun, bool]:
        """Create + enqueue a run. Returns (run, created_new)."""
        if idempotency_key:
            async with self._lock:
                existing = self._idempotency.get(idempotency_key)
            if existing and existing in self._runs:
                return self._runs[existing], False

        seed = config.random_seed if config.random_seed is not None \
            else settings.default_seed
        # validate up-front so bad configs fail fast (422) rather than in worker
        resolve_jurisdiction(config.jurisdiction_id)
        resolve_assumptions(config.assumptions_set)
        run = ScenarioRun(
            simulation_run_id=f"simrun:{uuid.uuid4().hex[:16]}",
            config=config.model_copy(update={"random_seed": seed}),
            idempotency_key=idempotency_key,
        )
        async with self._lock:
            self._runs[run.simulation_run_id] = run
            if idempotency_key:
                self._idempotency[idempotency_key] = run.simulation_run_id
        self._cancel_flags[run.simulation_run_id] = asyncio.Event()
        assert self._queue is not None, "RunManager.start() not called"
        try:
            self._queue.put_nowait(run.simulation_run_id)
        except asyncio.QueueFull:
            raise QueueFullError("Scenario run queue is full; retry later")
        log.info("run queued",
                 extra={"simulation_run_id": run.simulation_run_id,
                        "jurisdiction_id": config.jurisdiction_id})
        return run, True

    def get_run(self, run_id: str) -> ScenarioRun:
        run = self._runs.get(run_id)
        if run is None:
            raise NotFoundError(f"scenario run '{run_id}' not found")
        return run

    async def cancel(self, run_id: str) -> ScenarioRun:
        run = self.get_run(run_id)
        if run.status in TERMINAL_STATES:
            return run
        self._cancel_flags[run_id].set()
        if run.status == RunStatus.queued:
            run.status = RunStatus.canceled
            run.finished_at = datetime.now(timezone.utc)
        return run

    # ------------------------------------------------------------------
    # worker loop
    # ------------------------------------------------------------------
    async def _worker(self, worker_idx: int) -> None:
        while True:
            run_id = await self._queue.get()
            try:
                await self._execute(run_id)
            except Exception:  # never let a worker die
                log.exception("worker execution failed",
                              extra={"simulation_run_id": run_id})
            finally:
                self._queue.task_done()

    async def _execute(self, run_id: str) -> None:
        run = self._runs[run_id]
        if run.status == RunStatus.canceled:
            return
        run.status = RunStatus.running
        run.started_at = datetime.now(timezone.utc)
        config = run.config
        jur = resolve_jurisdiction(config.jurisdiction_id)
        asm = resolve_assumptions(config.assumptions_set)
        twin = self.twins.get_or_create(config.jurisdiction_id)
        log.info("run started", extra={"simulation_run_id": run_id,
                                       "jurisdiction_id": config.jurisdiction_id})
        try:
            results: list[EngineResult] = []
            plan = config.model_plan or []
            for idx, entry in enumerate(plan):
                if self._cancel_flags[run_id].is_set():
                    run.status = RunStatus.canceled
                    run.finished_at = datetime.now(timezone.utc)
                    return
                engine_seed = int(hashlib.sha256(
                    f"{config.random_seed}:{entry.engine.value}".encode()
                ).hexdigest()[:8], 16)
                ctx = EngineContext(config=config, plan=entry, jurisdiction=jur,
                                    assumptions=asm, random_seed=engine_seed)
                result = await asyncio.get_running_loop().run_in_executor(
                    None, run_engine, entry.engine.value, ctx)
                results.append(result)
                run.progress = round((idx + 1) / len(plan), 4)
                # persist engine artifact
                art = self.store.put_json(
                    f"runs/{run_id}/{entry.engine.value}-result.json",
                    result.model_dump(mode="json"))
                result.artifacts.append(ArtifactRef(**art))

            run.engine_results = results
            # evolve the digital twin
            evolved = self.twins.evolve(
                config.jurisdiction_id, run_id, [r.summary for r in results])
            run.reproducibility = results[0].reproducibility if results else None
            run.artifacts = [a for r in results for a in r.artifacts]
            manifest = self.store.put_json(
                f"runs/{run_id}/run-manifest.json",
                {**run.model_dump(mode="json"),
                 "twin_state_version": evolved.version})
            run.artifacts.append(ArtifactRef(**manifest))
            run.status = RunStatus.succeeded
            run.finished_at = datetime.now(timezone.utc)
            _record_run_metric(run, "succeeded")
            log.info("run succeeded", extra={"simulation_run_id": run_id})
        except Exception as exc:
            run.status = RunStatus.failed
            _record_run_metric(run, "failed")
            run.error = str(exc)
            run.finished_at = datetime.now(timezone.utc)
            log.warning(f"run failed: {exc}",
                        extra={"simulation_run_id": run_id})
            raise EngineExecutionError(str(exc)) from exc


def results_digest(run: ScenarioRun) -> str:
    """Stable digest over quantitative outputs only (excludes artifact URIs
    and other run-specific identifiers)."""
    quantitative = []
    for r in run.engine_results:
        dump = r.model_dump(mode="json")
        dump.pop("artifacts", None)
        quantitative.append(dump)
    payload = json.dumps(quantitative, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


def _record_run_metric(run, status: str) -> None:
    """OBS-1: simulation_runs_total{engine,status} (zero-dep metrics)."""
    try:
        from app.metrics import counter
        engines = "+".join(sorted({e.engine.value for e in
                                   run.config.model_plan})) or "unknown"
        counter("simulation_runs_total",
                "Simulation runs by engine set and status").inc(
                    {"engine": engines, "status": status})
    except Exception:
        pass
