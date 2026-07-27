# E2E API suite (`tests/e2e/`)

Zero-dependency Node runner (`e2e.mjs`) that exercises a **running** server
end to end. It is the E2E-API layer of `docs/TESTING.md` and the executable
half of `docs/NFR-EVIDENCE.md`.

## What it covers

| Group | Assertions |
| ----- | ---------- |
| health & envelope | `/healthz`, `/v1/health` standard `{data, meta, audit}` envelope |
| jurisdictions | `/v1/jurisdictions` list, `/v1/jurisdictions/:id/profile` envelope shape |
| read surface | rankings, search |
| error envelopes | 404 and 401/403 REST error envelope shape; `IDEMPOTENCY_KEY_REQUIRED` |
| metrics | `/metrics` exposes every series referenced by `infra/monitoring/alerts.yml` |
| idempotency | same `Idempotency-Key` on `/v1/opportunities/generate` → same job, `deduplicated: true` |
| scenario lifecycle | create scenario → add run → poll to terminal → results carry 80% uncertainty bands (lower ≤ mean ≤ upper) |
| brief RBAC matrix | generate → citations rail non-empty → analyst approves → analyst **cannot** signOff (403) → executive **can** |
| audit chain | `auditLog.verify` reports an intact hash chain |

## Setup

```bash
# 1. database up + migrated + seeded
npm run db:push
npx tsx db/seed.ts

# 2. e2e identities (policy_analyst / executive / simulation_specialist)
npx tsx tests/e2e/seed-users.ts

# 3. server running
npm run build && npm start        # or: npm run dev
```

## Run

```bash
BASE_URL=http://localhost:3000 node tests/e2e/e2e.mjs
```

Exit code is non-zero on any failure, so it gates CI (`e2e` job in
`.github/workflows/ci.yml`).

## How authentication works

The suite mints `kimi_sid` session cookies locally (HS256, same scheme as
`api/kimi/session.ts`) from `APP_SECRET` (env or repo-root `.env`) for the
seeded `e2e-*` users — no OAuth round trip needed in CI. If no secret is
available, the authenticated groups are reported as `skip` and only the
public assertions gate the run.

`mint-session.mjs` mints a cookie value by hand for k6 or curl:

```bash
SESSION_COOKIE=$(node tests/e2e/mint-session.mjs --union-id e2e-analyst)
curl -H "Cookie: kimi_sid=$SESSION_COOKIE" http://localhost:3000/v1/jobs/job:…
```
