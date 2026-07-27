# Scenario & Simulation Engine (`services/simulation`)

FastAPI microservice implementing spec **§22–23** (Forecasting, Causal
Inference, Microsimulation, Agent-Based Modeling, System Dynamics,
Optimization; Digital Twin & Scenario Engine) for the Jurisdiction Economic
Intelligence & Policy Twin Platform. Nigeria is the reference deployment.

## Quick start

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --port 8080
# tests
python -m pytest
```

Docker: `docker build -t simulation-engine . && docker run -p 8080:8080 simulation-engine`

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe |
| `POST` | `/v1/scenario-runs` | Create async scenario run → `{simulation_run_id, status: queued}` (supports `Idempotency-Key` header) |
| `GET` | `/v1/scenario-runs/{id}` | Status: `queued/running/succeeded/failed/canceled` + progress + artifact links |
| `GET` | `/v1/scenario-runs/{id}/results` | Typed engine results with uncertainty bands |
| `POST` | `/v1/scenario-runs/{id}/cancel` | Cancel a queued/running job |
| `GET` | `/v1/twins/{jurisdiction_id}` | Four-layer digital twin state |

All responses use the standard envelope `{data, meta{request_id,
correlation_id, api_version:"v1"}, audit{actor_id, generated_at}}`; errors use
`{error: {code, message, request_id, retryable, details}}`.

### Example

```bash
curl -X POST localhost:8080/v1/scenario-runs \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: kaduna-edu-001' \
  -d '{
    "jurisdiction_id": "jur:ng-kd",
    "assumptions_set": "asm:edu:base",
    "interventions": [{
      "intervention_id": "iv:kd-teacher-1", "name": "Teacher hiring",
      "sector": "education", "kind": "wage_subsidy",
      "budget_ngn_m": 2000, "target_population": 15000,
      "intensity": 0.7, "duration_months": 18
    }],
    "model_plan": [
      {"engine": "forecast", "horizon_months": 24},
      {"engine": "causal"},
      {"engine": "microsim"},
      {"engine": "abm", "horizon_months": 24},
      {"engine": "system_dynamics"},
      {"engine": "optimization", "parameters": {"budget_ngn_m": 5000}}
    ],
    "random_seed": 42
  }'

curl localhost:8080/v1/scenario-runs/<simulation_run_id>/results
```

## Engines (`app/engines/`)

Every engine implements the common protocol `run(ctx: EngineContext) ->
EngineResult` and returns typed outputs with **uncertainty bands**, artifacts,
`model_version` and full reproducibility metadata (`code_version`,
`engine_version`, `seed_data_version`, `random_seed` — spec §10).

| Engine | Module | Method |
|---|---|---|
| Forecasting | `forecast.py` | Holt linear-trend state-space + bootstrap prediction intervals (numpy). PyMC optional. |
| Causal inference | `causal.py` | DoWhy-style identify→estimate→refute; OLS covariate adjustment + placebo sensitivity check (numpy fallback). |
| Microsimulation | `microsim.py` | OpenFisca-style executable wage-subsidy / tax-credit / cash-transfer rules over a seeded synthetic population; decile distribution impacts with bootstrap bands. |
| Agent-based model | `abm.py` | Mesa-style worker/firm matching simulation of employment dynamics, N replications → bands. |
| System dynamics | `system_dynamics.py` | PySD-style stock-flow model (employed / skilled labour / firms, R1 + B1 loops), Euler integration, Monte-Carlo bands. |
| Optimization | `optimization.py` | Intervention portfolio selection under budget; greedy value-density + local exchange. OR-Tools optional. |

Heavy libraries (PyMC, DoWhy, Mesa, PySD, OR-Tools, boto3) are **optional
extras** (`requirements-extras.txt`); every engine detects availability via
try/import and falls back to its deterministic numpy implementation. The
service runs with only: fastapi, uvicorn, pydantic, numpy, httpx, pytest.

## Digital twin (`app/twin.py`)

Four-layer per-jurisdiction state model — **descriptive** (baseline
indicators), **behavioral** (calibrated parameters), **policy** (active
interventions/assumptions), **adaptive** (calibration drift + run history).
Each completed scenario run evolves the twin; versions are persisted as
artifacts.

## Persistence & reproducibility

Run metadata and engine artifacts are written as JSON under `./artifacts/`
(`ARTIFACT_DIR`). When `S3_BUCKET` (+ optional `S3_ENDPOINT_URL` for MinIO) is
configured and boto3 is installed, artifacts are also uploaded to S3.
Execution is fully deterministic: per-engine seeds derive from the scenario
`random_seed`; identical configs produce byte-identical quantitative results
(covered by `tests/test_reproducibility.py`).

## Configuration (env)

`HOST`, `PORT` (8080), `LOG_LEVEL`, `ARTIFACT_DIR`, `S3_ENDPOINT_URL`,
`S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `WORKER_COUNT` (4),
`MAX_QUEUE_SIZE` (256), `JOB_TTL_SECONDS`, `DEFAULT_SEED` (42).

## Seeded Nigeria pilot data (`app/data/seed.py`)

Jurisdictions `jur:ng` (federal), `jur:ng-kd` (Kaduna), `jur:ng-la` (Lagos),
`jur:ng-kn` (Kano); sectors education/sme/procurement/agriculture/health/
electricity; baseline metric series; assumptions sets (`asm:edu:base`,
`asm:sme:base`, `asm:agri:base`, `asm:stress:high-inflation`).
