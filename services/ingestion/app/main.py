"""FastAPI surface: ingestion job lifecycle, connector status, health."""
from __future__ import annotations

import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app import CODE_VERSION
from app.config import settings
from app.errors import ServiceError
from app.logging_setup import configure_logging, get_logger
from app.models import (Audit, Envelope, ErrorEnvelope, IngestRequest, Meta)
from app.worker import JobManager
from app.metrics import instrument, setup_tracing

configure_logging(settings.log_level)
log = get_logger("api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    manager = JobManager()
    await manager.start()
    app.state.jobs = manager
    yield
    await manager.stop()


app = FastAPI(
    title="Meridian Policy Twin — Ingestion Service",
    version=CODE_VERSION,
    description="Live data-source connectors (World Bank, HDX, Overpass, "
                "NADA, Budeshi, file harvester) with end-to-end provenance.",
    lifespan=lifespan,
)

instrument(app, settings.service_name)
setup_tracing(app, settings.service_name)


def _envelope(request: Request, data) -> Envelope:
    return Envelope(
        data=data,
        meta=Meta(request_id=getattr(request.state, "request_id", "-"),
                  correlation_id=getattr(request.state, "correlation_id", "-")),
        audit=Audit(actor_id=getattr(request.state, "actor_id", "anonymous")),
    )


@app.middleware("http")
async def request_context(request: Request, call_next):
    request.state.request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
    request.state.correlation_id = (
        request.headers.get("X-Correlation-ID") or request.state.request_id
    )
    request.state.actor_id = request.headers.get("X-Actor-ID") or "anonymous"
    return await call_next(request)


@app.exception_handler(ServiceError)
async def service_error_handler(request: Request, exc: ServiceError):
    body = ErrorEnvelope(
        code=exc.code, message=exc.message,
        request_id=getattr(request.state, "request_id", "-"),
        retryable=exc.retryable, details=exc.details,
    )
    return JSONResponse(status_code=exc.http_status,
                        content={"error": body.model_dump(mode="json")})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    body = ErrorEnvelope(
        code="VALIDATION_ERROR", message="Request validation failed",
        request_id=getattr(request.state, "request_id", "-"),
        retryable=False, details={"errors": exc.errors()},
    )
    return JSONResponse(status_code=422, content={"error": body.model_dump(mode="json")})


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    log.exception("unhandled error")
    body = ErrorEnvelope(
        code="INTERNAL_ERROR", message="Unexpected server error",
        request_id=getattr(request.state, "request_id", "-"),
        retryable=False, details={},
    )
    return JSONResponse(status_code=500, content={"error": body.model_dump(mode="json")})


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    return {"status": "ok", "service": settings.service_name,
            "version": CODE_VERSION, "api_version": settings.api_version}


@app.get("/v1/connectors")
async def list_connectors(request: Request):
    manager: JobManager = request.app.state.jobs
    return _envelope(request, [c.model_dump(mode="json")
                               for c in manager.connector_statuses()])


@app.post("/v1/ingest/{connector}", status_code=202)
async def ingest(
    connector: str,
    req: IngestRequest,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    manager: JobManager = request.app.state.jobs
    job, created = manager.create_job(connector, req, idempotency_key)
    return _envelope(request, {
        "job_id": job.job_id,
        "status": job.status.value,
        "created": created,
        "poll": f"/v1/ingest/jobs/{job.job_id}",
    })


@app.get("/v1/ingest/jobs/{job_id}")
async def job_status(job_id: str, request: Request):
    manager: JobManager = request.app.state.jobs
    job = manager.get(job_id)
    if not job:
        raise ServiceError(code="JOB_NOT_FOUND",
                           message=f"Job {job_id} not found", http_status=404)
    return _envelope(request, job.model_dump(mode="json"))
