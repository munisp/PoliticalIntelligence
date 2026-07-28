"""Async job manager with idempotency — same discipline as
services/ingestion JobManager."""
from __future__ import annotations

import asyncio
import json
import uuid

from app.errors import ServiceError
from app.logging_setup import get_logger
from app.models import DocumentJob, JobStatus, utcnow
from app.pipeline import run_pipeline
from app.storage import DocumentStore

log = get_logger("jobs")

MAX_UPLOAD = 10 * 1024 * 1024


class JobManager:
    def __init__(self, store: DocumentStore | None = None):
        self.store = store or DocumentStore()
        self.jobs: dict[str, DocumentJob] = {}
        self.documents: dict[str, str] = {}  # document_id -> job_id
        self._idempotency: dict[str, str] = {}
        self._tasks: set[asyncio.Task] = set()

    async def start(self) -> None:
        log.info("documents job manager started")

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()

    # ------------------------------------------------------------------
    def create_job(
        self,
        data: bytes,
        filename: str,
        *,
        title: str,
        jurisdiction_id: str,
        doc_type: str,
        language: str,
        document_id: str | None,
        idempotency_key: str | None,
    ) -> tuple[DocumentJob, bool]:
        if len(data) > MAX_UPLOAD:
            raise ServiceError(
                code="PAYLOAD_TOO_LARGE",
                message=f"Upload exceeds {MAX_UPLOAD} bytes",
                http_status=413,
            )
        if idempotency_key and idempotency_key in self._idempotency:
            return self.jobs[self._idempotency[idempotency_key]], False
        doc_id = document_id or f"doc:{uuid.uuid4().hex[:12]}"
        job = DocumentJob(job_id=f"docjob_{uuid.uuid4().hex[:12]}",
                          document_id=doc_id,
                          meta={"title": title,
                                "jurisdiction_id": jurisdiction_id,
                                "doc_type": doc_type, "language": language,
                                "filename": filename})
        self.jobs[job.job_id] = job
        self.documents[doc_id] = job.job_id
        if idempotency_key:
            self._idempotency[idempotency_key] = job.job_id
        task = asyncio.create_task(
            self._run(job, data, filename, title=title,
                      jurisdiction_id=jurisdiction_id, doc_type=doc_type,
                      language=language))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return job, True

    async def _run(self, job: DocumentJob, data: bytes, filename: str,
                   **meta) -> None:
        job.status = JobStatus.running
        job.started_at = utcnow()
        try:
            report = await asyncio.to_thread(
                run_pipeline, job, data, filename, self.store, **meta)
            job.status = JobStatus.succeeded
            try:
                from app.metrics import counter
                counter("documents_processed_total",
                        "Documents processed by the legal pipeline").inc(
                            {"status": "succeeded",
                             "doc_type": str(getattr(job, "doc_type", "unknown"))})
            except Exception:
                pass
            job.ocr_confidence = report.mean_ocr_confidence
        except Exception as exc:
            log.exception("document job %s failed", job.job_id)
            job.status = JobStatus.failed
            try:
                from app.metrics import counter
                counter("documents_processed_total",
                        "Documents processed by the legal pipeline").inc(
                            {"status": "failed",
                             "doc_type": str(getattr(job, "doc_type", "unknown"))})
            except Exception:
                pass
            job.error = str(exc)
            for st in job.stages:
                if st.status == "running":
                    st.status = "failed"
        finally:
            job.finished_at = utcnow()

    # ------------------------------------------------------------------
    def get_job(self, job_id: str) -> DocumentJob | None:
        return self.jobs.get(job_id)

    def job_for_document(self, document_id: str) -> DocumentJob | None:
        job_id = self.documents.get(document_id)
        return self.jobs.get(job_id) if job_id else None

    def reprocess(self, document_id: str) -> DocumentJob:
        """Re-run the pipeline from the stored raw artifact."""
        old = self.job_for_document(document_id)
        if not old or "raw" not in old.artifacts:
            raise ServiceError(code="DOCUMENT_NOT_FOUND",
                               message=f"No stored document {document_id}",
                               http_status=404)
        raw_uri = old.artifacts["raw"]
        data = self.store.get(raw_uri)
        meta = old.meta or {}
        job = DocumentJob(job_id=f"docjob_{uuid.uuid4().hex[:12]}",
                          document_id=document_id, meta=meta)
        self.jobs[job.job_id] = job
        self.documents[document_id] = job.job_id
        task = asyncio.create_task(self._run(
            job, data, meta.get("filename", "reprocess.bin"),
            title=meta.get("title", document_id),
            jurisdiction_id=meta.get("jurisdiction_id", "jur:ng"),
            doc_type=meta.get("doc_type", "act"),
            language=meta.get("language", "en")))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return job

    def artifact(self, document_id: str, kind: str) -> tuple[bytes, str]:
        job = self.job_for_document(document_id)
        if not job or kind not in job.artifacts:
            raise ServiceError(
                code="ARTIFACT_NOT_FOUND",
                message=f"No '{kind}' artifact for {document_id}",
                http_status=404)
        data = self.store.get(job.artifacts[kind])
        media = {
            "raw": "application/octet-stream",
            "ocr": "application/json",
            "clauses": "application/json",
            "edges": "application/json",
            "quality": "application/json",
            "akn": "application/xml",
        }.get(kind, "application/octet-stream")
        return data, media

    def quality(self, document_id: str) -> dict:
        data, _ = self.artifact(document_id, "quality")
        return json.loads(data)
