"""FastAPI surface: document upload → pipeline jobs, artifacts, quality."""
from __future__ import annotations

import json
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Form, Header, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from app import CODE_VERSION
from app.config import settings
from app.errors import ServiceError
from app.jobs import JobManager
from app.logging_setup import configure_logging, get_logger
from app.models import Audit, Clause, Envelope, ErrorEnvelope, Meta
from app.param_mapper import map_clauses_to_parameters
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
    title="Meridian Policy Twin — Document & Legal Processing Service",
    version=CODE_VERSION,
    description="Document ingestion, OCR (PaddleOCR/Docling/VLM), legal NLP "
                "and Akoma Ntoso structuring (spec §18).",
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


@app.post("/v1/documents", status_code=202)
async def upload_document(
    request: Request,
    file: UploadFile,
    title: str = Form(...),
    jurisdiction_id: str = Form(default="jur:ng"),
    doc_type: str = Form(default="act"),
    language: str = Form(default="en"),
    document_id: str | None = Form(default=None),
    idempotency_key: str | None = Header(default=None,
                                         alias="Idempotency-Key"),
):
    manager: JobManager = request.app.state.jobs
    data = await file.read()
    if not data:
        raise ServiceError(code="EMPTY_UPLOAD", message="Empty file",
                           http_status=422)
    job, created = manager.create_job(
        data, file.filename or "upload.bin", title=title,
        jurisdiction_id=jurisdiction_id, doc_type=doc_type,
        language=language, document_id=document_id,
        idempotency_key=idempotency_key)
    return _envelope(request, {
        "job_id": job.job_id,
        "document_id": job.document_id,
        "status": job.status.value,
        "created": created,
        "poll": f"/v1/documents/{job.document_id}",
    })


@app.post("/v1/akn/draft")
async def render_draft_akn(request: Request):
    """G4: Akoma Ntoso 3.0 for an evidence-grounded draft bill.

    Body: {title, clauses: [{section_path, heading?, text, kind?}], ria?,
           country?, doc_type?, year?, language?}
    Returns {akn_xml, problems} — problems lists structural-check violations
    (empty = well-formed per the AKN checklist).
    """
    from typing import Any

    from app import akn as akn_mod

    body: dict[str, Any] = await request.json()
    title = body.get("title")
    clauses = body.get("clauses")
    if not title or not isinstance(clauses, list) or not clauses:
        raise ServiceError(code="INVALID_DRAFT",
                           message="title and a non-empty clauses list are required",
                           http_status=422)
    for c in clauses:
        if not c.get("section_path") or not c.get("text"):
            raise ServiceError(code="INVALID_DRAFT",
                               message="each clause requires section_path and text",
                               http_status=422)
    xml = akn_mod.build_draft_akn(
        title,
        clauses,
        ria=body.get("ria"),
        country=body.get("country", "ng"),
        doc_type=body.get("doc_type", "bill"),
        year=body.get("year"),
        language=body.get("language", "eng"),
    )
    problems = akn_mod.structural_check(xml)
    return _envelope(request, {"akn_xml": xml, "problems": problems})


@app.get("/v1/documents/{document_id}")
async def get_document(document_id: str, request: Request):
    manager: JobManager = request.app.state.jobs
    job = manager.job_for_document(document_id)
    if not job:
        raise ServiceError(code="DOCUMENT_NOT_FOUND",
                           message=f"Document {document_id} not found",
                           http_status=404)
    return _envelope(request, job.model_dump(mode="json"))


@app.get("/v1/documents/{document_id}/artifacts/{kind}")
async def get_artifact(document_id: str, kind: str, request: Request):
    manager: JobManager = request.app.state.jobs
    data, media = manager.artifact(document_id, kind)
    return Response(content=data, media_type=media)


@app.get("/v1/documents/{document_id}/quality")
async def get_quality(document_id: str, request: Request):
    manager: JobManager = request.app.state.jobs
    return _envelope(request, manager.quality(document_id))


class ParamMapRequest(BaseModel):
    document_id: str | None = None
    clauses: list[Clause] | None = None
    top_k: int = 10


@app.post("/v1/param-map")
async def param_map(request: Request, body: ParamMapRequest):
    """G3: map extracted legal constructs to ranked simulation-parameter
    candidates (deterministic rules, analyst review required)."""
    clauses: list[Clause]
    if body.clauses is not None:
        clauses = body.clauses
    elif body.document_id:
        manager: JobManager = request.app.state.jobs
        try:
            data, _media = manager.artifact(body.document_id, "clauses")
        except ServiceError:
            raise
        except Exception:
            raise ServiceError(code="DOCUMENT_NOT_FOUND",
                               message=f"Document {body.document_id} not found",
                               http_status=404)
        clauses = [Clause(**c) for c in json.loads(data)]
    else:
        raise ServiceError(code="PARAM_MAP_INPUT_REQUIRED",
                           message="Provide document_id or clauses",
                           http_status=422)
    result = map_clauses_to_parameters(clauses, top_k=body.top_k)
    return _envelope(request, result.model_dump(mode="json"))


class DiffImpactRequest(BaseModel):
    clauses_a: list[Clause]
    clauses_b: list[Clause]


@app.post("/v1/diff-impact")
async def diff_impact(request: Request, body: DiffImpactRequest):
    """I4: diff two bill versions (clauses A vs B) — added/removed/changed
    obligations, parameter deltas (instrument/scale) and per-change impact
    notes. Deterministic rules; analyst review required."""
    from app.diff_impact import compute_diff_impact

    if not body.clauses_a and not body.clauses_b:
        raise ServiceError(code="DIFF_IMPACT_INPUT_REQUIRED",
                           message="Provide clauses_a and/or clauses_b",
                           http_status=422)
    result = compute_diff_impact(body.clauses_a, body.clauses_b)
    return _envelope(request, result.model_dump(mode="json"))


@app.post("/v1/documents/{document_id}/reprocess", status_code=202)
async def reprocess(document_id: str, request: Request):
    manager: JobManager = request.app.state.jobs
    job = manager.reprocess(document_id)
    return _envelope(request, {
        "job_id": job.job_id,
        "document_id": job.document_id,
        "status": job.status.value,
        "poll": f"/v1/documents/{job.document_id}",
    })
