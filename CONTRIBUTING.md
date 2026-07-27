# Contributing

Thanks for helping build an open, sovereign-ready policy intelligence platform.

## Branch & PR workflow

1. Fork or branch from `main`. Branch naming:
   - `feat/<short-slug>` — features
   - `fix/<short-slug>` — bug fixes
   - `infra/<short-slug>` — infrastructure/CI/docs
   - `data/<short-slug>` — source onboarding, schemas, dbt models
2. Keep PRs focused and small enough to review in one sitting.
3. Every PR must: pass CI (`ci.yml` node/python/docker jobs + CodeQL), include or update tests for behavior changes, and update docs when contracts, events, env vars, or runbooks change.
4. Schema changes (`db/`, `contracts/`, event topics) require explicit review from a data steward and must include a migration/re-index plan (see `docs/DATA_MODEL.md`).
5. Prompt, model-tier, or routing-policy changes require the eval + prompt-regression gate (see `docs/TESTING.md`).
6. Squash-merge with a clean commit message after at least one approval.

## Code standards

- **TypeScript:** strict mode; run `npm run check` and `npm run build` before pushing. No `any` without justification; domain-first naming per `docs/API.md`.
- **Python:** 3.12, type hints on public functions, `pytest` for tests; FastAPI routers stay thin — logic in service modules.
- **Errors & envelopes:** APIs return the standard response/error envelopes; mutating endpoints accept idempotency keys; heavy work is async (`202` + job).
- **Events:** new topics follow `<domain>.<entity>.<verb>`, are documented in `docs/EVENTS.md` with producer/consumer/DLQ notes, and schemas go in `contracts/`.
- **Observability:** new services/jobs emit metrics (latency, success/failure, queue depth) and structured logs with correlation ids.
- **Security:** never commit secrets; use Vault/External Secrets in deployed envs, `.env` locally (gitignored). Respect RBAC and jurisdiction-level policy checks — retrieval must filter before generation.

## Commit conventions

Conventional Commits:

```
<type>(<optional scope>): <imperative summary>
```

Types: `feat`, `fix`, `infra`, `docs`, `data`, `test`, `refactor`, `chore`.
Examples:

- `feat(api): add cursor pagination to /v1/opportunities`
- `data(sources): onboard UBEC factsheets with dbt contracts`
- `infra(k8s): add prod network policies`

## Getting set up

See the Quickstart in [README.md](README.md). If you're onboarding a Nigerian data source, work through the ten-gate checklist in [docs/NIGERIA_PILOT.md](docs/NIGERIA_PILOT.md).
