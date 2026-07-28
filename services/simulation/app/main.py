"""FastAPI surface: scenario-run lifecycle, health, twin inspection."""
from __future__ import annotations

import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app import CODE_VERSION
from app.backtest import (BacktestRequest, persist_report,
                          recalibrate_from_backtest, run_backtest)
from app.config import settings
from app.engines import resolve_jurisdiction
from app.errors import ServiceError
from app.logging_setup import configure_logging, get_logger
from app.models import (Audit, Envelope, ErrorEnvelope, Meta, ScenarioConfig,
                        ScenarioRunPublic, ScenarioRunResults, utcnow)
from app.worker import RunManager
from app.metrics import instrument, setup_tracing

configure_logging(settings.log_level)
log = get_logger("api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    manager = RunManager()
    await manager.start()
    app.state.runs = manager
    yield
    await manager.stop()


app = FastAPI(
    title="Jurisdiction Scenario & Simulation Engine",
    version=CODE_VERSION,
    description="Spec sections 22-23: forecasting, causal inference, "
                "microsimulation, ABM, system dynamics, optimization, "
                "and the four-layer digital twin.",
    lifespan=lifespan,
)

instrument(app, settings.service_name)
setup_tracing(app, settings.service_name)


# ---------------------------------------------------------------------------
# Envelope helpers & error handling
# ---------------------------------------------------------------------------
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
    request.state.correlation_id = request.headers.get("X-Correlation-ID") or \
        request.state.request_id
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
    return JSONResponse(status_code=422,
                        content={"error": body.model_dump(mode="json")})


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    log.exception("unhandled error")
    body = ErrorEnvelope(
        code="INTERNAL_ERROR", message="Unexpected server error",
        request_id=getattr(request.state, "request_id", "-"),
        retryable=False, details={},
    )
    return JSONResponse(status_code=500,
                        content={"error": body.model_dump(mode="json")})


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    return {"status": "ok", "service": settings.service_name,
            "version": CODE_VERSION, "api_version": settings.api_version}


@app.post("/v1/scenario-runs", status_code=201)
async def create_scenario_run(
    config: ScenarioConfig,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    manager: RunManager = request.app.state.runs
    run, created = await manager.create_run(config, idempotency_key)
    payload = {
        "simulation_run_id": run.simulation_run_id,
        "status": run.status.value,
        "created": created,
    }
    response = _envelope(request, payload)
    return JSONResponse(status_code=201 if created else 200,
                        content=response.model_dump(mode="json"))


@app.get("/v1/scenario-runs/{run_id}")
async def get_scenario_run(run_id: str, request: Request):
    manager: RunManager = request.app.state.runs
    run = manager.get_run(run_id)
    public = ScenarioRunPublic(
        simulation_run_id=run.simulation_run_id,
        status=run.status,
        progress=run.progress,
        jurisdiction_id=run.config.jurisdiction_id,
        created_at=run.created_at,
        finished_at=run.finished_at,
        error=run.error,
        artifact_links=run.artifacts,
        results_link=f"/v1/scenario-runs/{run.simulation_run_id}/results",
    )
    return _envelope(request, public).model_dump(mode="json")


@app.get("/v1/scenario-runs/{run_id}/results")
async def get_scenario_run_results(run_id: str, request: Request):
    manager: RunManager = request.app.state.runs
    run = manager.get_run(run_id)
    twin = manager.twins.snapshot(run.config.jurisdiction_id)
    results = ScenarioRunResults(
        simulation_run_id=run.simulation_run_id,
        status=run.status,
        engine_results=run.engine_results,
        twin_state_version=twin.version if twin else 0,
    )
    return _envelope(request, results).model_dump(mode="json")


@app.post("/v1/scenario-runs/{run_id}/cancel")
async def cancel_scenario_run(run_id: str, request: Request):
    manager: RunManager = request.app.state.runs
    run = await manager.cancel(run_id)
    return _envelope(request, {"simulation_run_id": run.simulation_run_id,
                               "status": run.status.value}).model_dump(mode="json")


@app.post("/v1/backtests")
async def run_backtest_endpoint(req: BacktestRequest, request: Request):
    """SIM-5: walk-forward backtest of all engines vs historical outcomes.

    Returns the calibration report (per-engine MAPE / RMSE / 80%-band
    coverage / skill vs naive across multiple cutoff windows), persists the
    report artifact, and — when ``recalibrate`` is set — applies
    backtest-derived prior adjustments to the digital twin."""
    manager: RunManager = request.app.state.runs
    resolve_jurisdiction(req.jurisdiction_id)  # fail fast with 4xx
    report = run_backtest(req)
    persist_report(report, manager.store)
    if req.recalibrate:
        manager.twins.get_or_create(req.jurisdiction_id)
        recalibrate_from_backtest(report, manager.twins)
    return _envelope(request, report.model_dump(mode="json")).model_dump(mode="json")


@app.get("/v1/twins/{jurisdiction_id}")
async def get_twin(jurisdiction_id: str, request: Request):
    manager: RunManager = request.app.state.runs
    twin = manager.twins.get_or_create(jurisdiction_id)
    return _envelope(request, twin.model_dump(mode="json")).model_dump(mode="json")


def main() -> None:  # pragma: no cover
    import uvicorn
    uvicorn.run("app.main:app", host=settings.host, port=settings.port)


if __name__ == "__main__":  # pragma: no cover
    main()
