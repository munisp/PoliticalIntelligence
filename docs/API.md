# API Design

The public API is served by the root Node app (Hono + tRPC) under `/v1`. Internal Python services (`services/simulation` :8100, `services/ai` :8200) expose narrower service APIs consumed by the gateway; they are not public surface.

## Design principles

1. **Domain-first.** Endpoints are organized by the domain language of government users (jurisdictions, sectors, opportunities, legislation, briefs) — not by storage technology. One canonical URL per resource.
2. **Versioned.** All routes live under `/v1`. Breaking changes require a new version prefix; non-breaking additive changes ship in place.
3. **Async-by-default for heavy work.** Anything involving LLM generation, simulation ensembles, bulk parsing, or report builds returns `202 Accepted` with a job handle instead of blocking. Clients poll the job or subscribe to its completion event (see `EVENTS.md`).
4. **Idempotency keys.** All mutating `POST`s accept an `Idempotency-Key` header. Retrying with the same key returns the original result; duplicates never create duplicate jobs or records.
5. **Cursor pagination.** List endpoints accept `?cursor=&limit=` (default limit 50, max 200) and return `meta.next_cursor`. Offset pagination is not used.
6. **Structured error envelopes.** Errors are machine-readable and consistent; never a bare stack trace.
7. **Standard response envelope.** Every response carries `data`, `meta`, and `audit` blocks:

```json
{
  "data": { "...": "..." },
  "meta": {
    "request_id": "req_01JZK8K0F6V7M4W3A2QK9Y4J0C",
    "correlation_id": "corr_01JZK8JY3N7B0K0X7R2E0N1R9F",
    "api_version": "v1",
    "next_cursor": null
  },
  "audit": {
    "actor_id": "user_9f2c1a",
    "generated_at": "2025-06-30T14:22:11.415Z"
  }
}
```

Error envelope:

```json
{
  "error": {
    "code": "JURISDICTION_NOT_FOUND",
    "message": "No jurisdiction with id 'nga-ng-zz'.",
    "details": { "jurisdiction_id": "nga-ng-zz" },
    "retryable": false
  },
  "meta": { "request_id": "req_01JZ…", "correlation_id": "corr_01JZ…", "api_version": "v1" },
  "audit": { "actor_id": "user_9f2c1a", "generated_at": "2025-06-30T14:23:02.001Z" }
}
```

Auth: OIDC bearer tokens from Keycloak (see `SECURITY.md`). Every response's `audit` block and the immutable audit log record the acting principal.

## Endpoint domains

| Domain                    | Representative routes                                                        | Notes                                            |
| ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------ |
| Auth                      | `GET /v1/auth/me`, `GET /v1/auth/permissions`                                | OIDC session, effective RBAC/policy grants       |
| Jurisdictions             | `GET /v1/jurisdictions`, `GET /v1/jurisdictions/{id}/profile`                | Federal/state/LGA/ward hierarchy + profile       |
| Sectors                   | `GET /v1/sectors`, `GET /v1/sectors/{id}/indicators`                         | Pilot sectors: education, SME, procurement       |
| Opportunities             | `POST /v1/opportunities/generate`, `GET /v1/opportunities`                   | Async generation job → ranked opportunity cards  |
| Scenarios / simulations   | `POST /v1/scenarios`, `GET /v1/scenarios/{id}`, `GET /v1/simulations/{id}`   | Async; reproducible run manifests                |
| Legislation               | `GET /v1/legislation`, `POST /v1/legislation/compare`                        | Bills/acts, comparisons, impact notes            |
| Documents                 | `POST /v1/documents`, `GET /v1/documents/{id}`                               | Upload → parse pipeline; provenance preserved    |
| Search                    | `GET /v1/search?q=`                                                          | Hybrid vector+graph+SQL retrieval                |
| Briefs                    | `POST /v1/briefs/generate`, `GET /v1/briefs/{id}`                            | Async executive brief generation with citations  |
| Admin                     | `GET /v1/admin/sources`, `POST /v1/admin/sources/{id}/refresh`               | Source registry, onboarding checklist status     |
| Observability             | `GET /v1/observability/health`, `GET /v1/observability/sources/freshness`    | Data source health console backing endpoints     |

## Representative examples

### Jurisdiction profile

`GET /v1/jurisdictions/nga-ng-kd/profile` → `200`

```json
{
  "data": {
    "jurisdiction": {
      "id": "nga-ng-kd",
      "name": "Kaduna State",
      "level": "state",
      "parent_id": "nga-ng",
      "population": 8252366,
      "geometry_ref": "postgis:boundaries/lga/nga-ng-kd"
    },
    "headline_indicators": [
      { "code": "EDU_PRIMARY_ENROLMENT", "value": 1184230, "year": 2023, "source": "UBEC" },
      { "code": "SME_NEW_REGISTRATIONS", "value": 9412, "year": 2024, "source": "CAC" }
    ],
    "active_scenarios": 3,
    "last_data_refresh": "2025-06-28T03:00:00Z"
  },
  "meta": { "request_id": "req_01JZ…", "correlation_id": "corr_01JZ…", "api_version": "v1" },
  "audit": { "actor_id": "user_9f2c1a", "generated_at": "2025-06-30T14:25:41.900Z" }
}
```

### Generate opportunities (async job)

`POST /v1/opportunities/generate` with header `Idempotency-Key: 4d2f…` → `202`

Request:

```json
{
  "jurisdiction_id": "nga-ng-kd",
  "sector_id": "sme-formation",
  "horizon_months": 24,
  "constraints": { "max_budget_ngn_m": 500, "priority": "job_creation" }
}
```

Response:

```json
{
  "data": {
    "job_id": "job_01JZK9R2E8XQ9Z0N3P0F4T0V8Y",
    "status": "queued",
    "status_url": "/v1/jobs/job_01JZK9R2E8XQ9Z0N3P0F4T0V8Y",
    "result_url": "/v1/opportunities?job_id=job_01JZK9R2E8XQ9Z0N3P0F4T0V8Y"
  },
  "meta": { "request_id": "req_01JZ…", "correlation_id": "corr_01JZ…", "api_version": "v1" },
  "audit": { "actor_id": "user_9f2c1a", "generated_at": "2025-06-30T14:26:03.112Z" }
}
```

The job emits `scenarios.run.requested` → `recommendations.generated`; completion is visible via `status_url` (`queued|running|succeeded|failed`) and the result set via `result_url`.

### Create a scenario

`POST /v1/scenarios` → `202`

```json
{
  "jurisdiction_id": "nga-ng-kd",
  "name": "Procurement localization — 40% SME award share",
  "levers": [
    { "code": "PROC_SME_AWARD_SHARE", "value": 0.40 },
    { "code": "PROC_PAYMENT_DAYS", "value": 30 }
  ],
  "baseline_run_id": null,
  "ensemble_size": 64,
  "seed": 42
}
```

Response:

```json
{
  "data": {
    "scenario_id": "scn_01JZKAB6N4M2Q8H7C5D3E1F0GA",
    "simulation_run_id": "run_01JZKAC1N2P6W4T8R9Y0E2F5HB",
    "status": "queued",
    "status_url": "/v1/simulations/run_01JZKAC1N2P6W4T8R9Y0E2F5HB"
  },
  "meta": { "request_id": "req_01JZ…", "correlation_id": "corr_01JZ…", "api_version": "v1" },
  "audit": { "actor_id": "user_7d1b3e", "generated_at": "2025-06-30T14:27:19.540Z" }
}
```

Simulation completion publishes `simulations.run.completed` with the run manifest (inputs, seed, model/data versions) so every result is reproducible (see `DATA_MODEL.md` → SimulationRun).
