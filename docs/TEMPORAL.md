# Temporal runbook — durable workflows (ADR-010)

Temporal provides durable execution for long, multi-service pipelines. The
existing in-process job runner (`api/runner.ts`) remains the default for
short background jobs; Temporal takes the long, failure-prone ones. Both
coexist — see **Migration phases** below.

## Components

| Piece | Where | Notes |
|---|---|---|
| Temporal server | compose `temporal` (auto-setup), k8s `infra/k8s/base/temporal.yaml` | dev-grade single replica, Postgres persistence |
| Temporal DB | compose `temporal-db` (postgres:16) | dedicated container — deliberately separate from the postgis service |
| Temporal UI | compose `temporal-ui` → http://localhost:8088 | inspect/replay workflows |
| Go worker | `services/workflows-go` | implements `IngestionPipelineWorkflow` + `SimulationRunWorkflow`; polls task queue `policy-twin` |
| TS trigger bridge | `api/bridges/temporal.ts` | starts workflows via `@temporalio/client`; **falls back to the direct ingestion trigger when `TEMPORAL_URL` is unset** |
| tRPC surface | `workflows.ingestion.runWorkflow` (data_steward), `workflows.status` | `api/workflows.ts` |

## Dev up

```bash
docker compose -f infra/docker/docker-compose.yml up -d temporal temporal-db temporal-ui
# worker (opt-in profile):
docker compose -f infra/docker/docker-compose.yml --profile workflows up -d workflows-worker
```

Env wiring (already defaulted in compose for `api-gateway`):

- `TEMPORAL_URL=temporal:7233` — unset/empty ⇒ runner fallback
- `TEMPORAL_NAMESPACE=default`
- `TEMPORAL_TASK_QUEUE=policy-twin`

## Workflows

### IngestionPipelineWorkflow
`RunConnector → ValidateBatch → LoadCanonical → RefreshAlerts`

- Activities call the **existing** ingestion service HTTP endpoints
  (`POST /v1/ingest/{connector}`, `GET /v1/ingest/jobs/{job_id}`) — Temporal
  orchestrates; the Python pipeline (`services/ingestion/app/pipeline.py`)
  still does the work.
- A failed data contract (`schema_ok=false`) fails the workflow
  non-retryably after `ValidateBatch`; `LoadCanonical`/`RefreshAlerts` never
  run (covered by unit tests).
- `RefreshAlerts` re-emits `features.materialized` to Redpanda so the
  existing Node consumers refresh alerts/recommendations.

Trigger:

```ts
// tRPC (data_steward):
await trpc.workflows.ingestion.runWorkflow.mutate({ connector: "worldbank", jurisdiction: "ng" });
// → { data: { mode: "temporal" | "fallback", id, status } }
```

### SimulationRunWorkflow
`SubmitRun → PollCompletion → EmitEvent` over `POST/GET /v1/scenario-runs*`,
emitting `simulations.run.completed` for the existing consumers.

## Worker build & tests {#ci}

```bash
cd services/workflows-go
go build ./...     # worker binary
go test ./...      # workflow unit tests (temporalio testsuite, mocked activities)
docker build -t policy-twin/workflows-go:local .
```

> **Toolchain note:** the dev sandbox has **no Go toolchain** — the unit
> tests (`workflows_test.go`) and `go.sum` generation are a **CI gate**.
> CI must run `go mod tidy && go build ./... && go test ./...` on any change
> under `services/workflows-go/`.

## Migration phases (legacy job queue)

1. **Phase 0 (today).** In-process runner is the only engine; Temporal stack
   is available but nothing depends on it (`TEMPORAL_URL` unset ⇒ identical
   behaviour, fallback path covered by `api/tests/temporal-bridge.test.ts`).
2. **Phase 1 (this change).** Ingestion pipeline runs are Temporal-capable:
   `workflows.ingestion.runWorkflow` prefers Temporal, degrades to the
   direct trigger. No existing runner job types are touched.
3. **Phase 2 (next).** Long simulation runs move behind
   `SimulationRunWorkflow`; the runner keeps short jobs (radar scans, brief
   generation). Status polling unifies on workflow id vs job id in the API.
4. **Phase 3 (later).** The ingestion scheduler and Dagster profile
   (ING-8) delegate execution to Temporal schedules; runner remains for
   request-scoped jobs only. A job type migrates only after its workflow
   has parity tests and one full staging soak.

**Rule:** migration is per-job-type, opt-in, and reversible — setting
`TEMPORAL_URL` empty reverts any environment to the runner path.
