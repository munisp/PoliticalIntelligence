"""Async job manager — same discipline as services/simulation RunManager."""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime

from app.connectors import REGISTRY, get_connector
from app.logging_setup import get_logger
from app.models import (ConnectorStatus, IngestRequest, JobPublic, JobStatus,
                        utcnow)
from app.pipeline import run_pipeline

log = get_logger("worker")


class JobManager:
    def __init__(self, producer=None, artifacts_dir: str | None = None):
        self.jobs: dict[str, JobPublic] = {}
        self._idempotency: dict[str, str] = {}
        self._tasks: set[asyncio.Task] = set()
        self._producer = producer
        self._artifacts_dir = artifacts_dir
        self.last_run: dict[str, JobPublic] = {}  # connector -> latest job
        self.totals: dict[str, int] = {}  # connector -> cumulative records_out

    async def start(self) -> None:
        log.info("job manager started")

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()

    def create_job(
        self, connector: str, req: IngestRequest, idempotency_key: str | None
    ) -> tuple[JobPublic, bool]:
        if connector not in REGISTRY:
            from app.errors import ServiceError
            raise ServiceError(
                code="CONNECTOR_NOT_FOUND",
                message=f"Unknown connector '{connector}'. "
                        f"Available: {sorted(REGISTRY)}",
                http_status=404,
            )
        if idempotency_key and idempotency_key in self._idempotency:
            return self.jobs[self._idempotency[idempotency_key]], False
        job = JobPublic(
            job_id=f"ing_{uuid.uuid4().hex[:12]}",
            connector=connector,
            status=JobStatus.queued,
            created_at=utcnow(),
        )
        self.jobs[job.job_id] = job
        if idempotency_key:
            self._idempotency[idempotency_key] = job.job_id
        task = asyncio.create_task(self._run(job, req))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return job, True

    async def _run(self, job: JobPublic, req: IngestRequest) -> None:
        job.status = JobStatus.running
        job.started_at = datetime.now(tz=utcnow().tzinfo)
        try:
            summary = await asyncio.to_thread(
                run_pipeline,
                get_connector(job.connector),
                req.jurisdiction,
                req.since,
                req.params,
                self._producer,
                self._artifacts_dir,
            )
            job.status = JobStatus.succeeded
            job.records_in = summary["records_in"]
            job.records_out = summary["records_out"]
            job.artifact = summary["artifact"]
            job.contract = summary["contract"]
            job.loader = summary.get("loader")
            self.totals[job.connector] = (
                self.totals.get(job.connector, 0) + job.records_out
            )
        except Exception as exc:  # surfaced via job status + error field
            log.exception("job %s failed", job.job_id)
            job.status = JobStatus.failed
            job.error = str(exc)
        finally:
            job.finished_at = datetime.now(tz=utcnow().tzinfo)
            self.last_run[job.connector] = job

    def get(self, job_id: str) -> JobPublic | None:
        return self.jobs.get(job_id)

    def connector_statuses(self) -> list[ConnectorStatus]:
        out = []
        for name, cls in sorted(REGISTRY.items()):
            last = self.last_run.get(name)
            out.append(ConnectorStatus(
                name=name,
                description=cls.description,
                live=True,
                last_fetch_at=last.finished_at if last else None,
                last_job=last,
                total_records=self.totals.get(name, 0),
            ))
        return out
