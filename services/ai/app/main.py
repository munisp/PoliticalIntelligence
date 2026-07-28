"""FastAPI surface: hybrid retrieval, recommendations, copilot, routing audit."""
from __future__ import annotations

import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app import CODE_VERSION
from app.config import settings
from app.errors import ServiceError, ValidationError
from app.llm.offline import synthesize_copilot_answer, synthesize_recommendation
from app.llm.router import ModelRouter, audit_log
from app.llm.serving import ServingClient
from app.logging_setup import configure_logging, get_logger
from app.models import (Audit, CopilotQuery, Envelope, ErrorEnvelope, Meta,
                        RecommendationRequest, RetrieveRequest)
from app.retrieval.fusion import HybridRetriever
from app.metrics import instrument, setup_tracing

configure_logging(settings.log_level)
log = get_logger("api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.retriever = HybridRetriever()
    app.state.serving = ServingClient()  # env-driven; unconfigured -> offline
    app.state.router = ModelRouter(serving=app.state.serving)
    # Embedding indexer scheduler hook (AI-12): when INDEXER_INTERVAL_SECONDS
    # is set, reindex passages on that cadence in a daemon thread.
    import os
    if os.getenv("INDEXER_INTERVAL_SECONDS"):
        from app.retrieval import indexer
        app.state.indexer_thread = indexer.start_index_scheduler()
    log.info("service started", extra={
        "request_id": "startup",
        "model_tier": "offline" if not app.state.router.online else "online",
    })
    yield


app = FastAPI(
    title="Hybrid Retrieval + LLM Routing Service",
    version=CODE_VERSION,
    description="Spec sections 20-21: Vector+Graph+SQL retrieval with RRF "
                "fusion; policy-based LLM routing with deterministic offline "
                "synthesizer (fully functional without GPUs).",
    lifespan=lifespan,
)

instrument(app, settings.service_name)
setup_tracing(app, settings.service_name)


# ---------------------------------------------------------------------------
def _envelope(request: Request, data) -> dict:
    return Envelope(
        data=data,
        meta=Meta(request_id=getattr(request.state, "request_id", "-"),
                  correlation_id=getattr(request.state, "correlation_id", "-")),
        audit=Audit(actor_id=getattr(request.state, "actor_id", "anonymous")),
    ).model_dump(mode="json")


@app.middleware("http")
async def request_context(request: Request, call_next):
    request.state.request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
    request.state.correlation_id = request.headers.get("X-Correlation-ID") or \
        request.state.request_id
    request.state.actor_id = request.headers.get("X-Actor-ID") or "anonymous"
    return await call_next(request)


@app.exception_handler(ServiceError)
async def service_error_handler(request: Request, exc: ServiceError):
    body = ErrorEnvelope(code=exc.code, message=exc.message,
                         request_id=getattr(request.state, "request_id", "-"),
                         retryable=exc.retryable, details=exc.details)
    return JSONResponse(status_code=exc.http_status,
                        content={"error": body.model_dump(mode="json")})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    body = ErrorEnvelope(code="VALIDATION_ERROR",
                         message="Request validation failed",
                         request_id=getattr(request.state, "request_id", "-"),
                         retryable=False,
                         details={"errors": exc.errors()})
    return JSONResponse(status_code=422,
                        content={"error": body.model_dump(mode="json")})


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    log.exception("unhandled error")
    body = ErrorEnvelope(code="INTERNAL_ERROR", message="Unexpected server error",
                         request_id=getattr(request.state, "request_id", "-"),
                         retryable=False, details={})
    return JSONResponse(status_code=500,
                        content={"error": body.model_dump(mode="json")})


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health")
async def health(request: Request):
    router: ModelRouter = request.app.state.router
    return {
        "status": "ok",
        "service": settings.service_name,
        "version": CODE_VERSION,
        "api_version": settings.api_version,
        "llm_mode": "online" if router.online else "offline-synthesizer",
        "adapter_modes": request.app.state.retriever.adapter_modes(),
    }


@app.post("/v1/retrieve")
async def retrieve(req: RetrieveRequest, request: Request):
    retriever: HybridRetriever = request.app.state.retriever
    bundle = retriever.retrieve(req.query, req.jurisdiction_id, req.filters,
                                req.top_k)
    try:
        from app.metrics import counter
        counter("retrieval_requests_total",
                "Hybrid retrieval requests").inc({
                    "paths": "+".join(sorted(
                        p.value for p in bundle.retrieval_paths_used)) or "none"})
    except Exception:
        pass
    return _envelope(request, bundle)


@app.post("/v1/recommendations")
async def recommendations(req: RecommendationRequest, request: Request):
    retriever: HybridRetriever = request.app.state.retriever
    router: ModelRouter = request.app.state.router
    filters = dict(req.filters)
    if req.sector:
        filters["sector"] = req.sector
    bundle = retriever.retrieve(req.query, req.jurisdiction_id, filters, req.top_k)
    if not bundle.evidence:
        raise ValidationError(
            "No evidence retrieved for the given query/jurisdiction",
            details={"query": req.query, "jurisdiction_id": req.jurisdiction_id})
    _, routing_meta = router.generate(
        req.workload_class, prompt=_recommendation_prompt(req.query, bundle),
        request_id=request.state.request_id)
    # Whether or not a live LLM responded, the deterministic synthesizer
    # guarantees the structured contract (online completions enrich later via
    # prompt-bundle fine-tuning; contract shape must never depend on GPUs).
    rec = synthesize_recommendation(bundle, req.sector, routing_meta)
    return _envelope(request, rec)


def _recommendation_prompt(query: str, bundle) -> str:
    lines = [f"Policy query: {query}",
             f"Jurisdiction: {bundle.jurisdiction_id}", "Evidence:"]
    for e in bundle.evidence[:6]:
        lines.append(f"- [{e.evidence_source_id}] {e.content} ({e.citation})")
    return "\n".join(lines)


@app.post("/v1/copilot/query")
async def copilot_query(req: CopilotQuery, request: Request):
    retriever: HybridRetriever = request.app.state.retriever
    router: ModelRouter = request.app.state.router
    bundle = retriever.retrieve(req.query, req.jurisdiction_id, {}, req.top_k)
    text, routing_meta = router.generate(
        req.workload_class,
        prompt=f"Answer with citations.\n\n{_recommendation_prompt(req.query, bundle)}",
        request_id=request.state.request_id)
    if text:  # online LLM answered; wrap it in the citation contract
        answer = synthesize_copilot_answer(bundle, routing_meta).model_copy(
            update={"answer": text})
    else:
        answer = synthesize_copilot_answer(bundle, routing_meta)
    return _envelope(request, answer)


@app.get("/v1/routing/audit")
async def routing_audit(request: Request, limit: int = 100):
    entries = [e.model_dump(mode="json") for e in audit_log.list(limit)]
    return _envelope(request, {"entries": entries, "count": len(entries)})


@app.get("/v1/serving/metrics")
async def serving_metrics(request: Request):
    """Per-tier serving metrics: requests, failures, p95 latency, breakers."""
    serving: ServingClient = request.app.state.serving
    return _envelope(request, serving.metrics_snapshot())


@app.get("/v1/regression/latest")
async def regression_latest(request: Request):
    """Latest model/prompt regression report (golden Q&A harness)."""
    from app import regression
    report = regression.latest_report()
    if report is None:  # first call computes it (fast, fully offline)
        report = regression.run_regression()
    return _envelope(request, report.to_dict())


def main() -> None:  # pragma: no cover
    import uvicorn
    uvicorn.run("app.main:app", host=settings.host, port=settings.port)


if __name__ == "__main__":  # pragma: no cover
    main()
