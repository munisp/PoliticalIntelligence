# k6 load profiles (NFR performance evidence)

These scripts implement the load-test row of `docs/TESTING.md` (NFR table):

| Script | NFR | Profile | Thresholds |
| ------ | --- | ------- | ---------- |
| `api-reads.k6.js` | Read latency p95 < 5s; 100 concurrent read sessions; error rate < 1% | 100 VU constant, 5m | `p(95)<5000ms`, `http_req_failed<1%` |
| `advisory.k6.js` | Advisory/generation latency p95 < 20s; 20 concurrent LLM sessions | 20 VU constant, 5m | `p(95)<20000ms`, `http_req_failed<1%` |
| `smoke.k6.js` | CI sanity | 5 VU, 30s | `p(95)<5000ms`, `http_req_failed<1%` |

## Prereqs

A running server (`npm run build && npm start`, or staging) seeded with the
Nigeria pilot data (`npx tsx db/seed.ts`). `BASE_URL` defaults to
`http://localhost:3000`.

## Run with local k6

```bash
k6 run tests/k6/smoke.k6.js
BASE_URL=http://localhost:3000 k6 run tests/k6/api-reads.k6.js

# Advisory paths need an authenticated session (see tests/e2e/README.md):
SESSION_COOKIE=$(node tests/e2e/mint-session.mjs --union-id e2e-analyst) \
  k6 run tests/k6/advisory.k6.js
```

## Run with Docker (no local k6 install)

```bash
docker run --rm -i --network host \
  -v "$PWD/tests/k6:/scripts" \
  -e BASE_URL=http://localhost:3000 \
  grafana/k6 run /scripts/api-reads.k6.js
```

## Sandbox equivalent

Where k6 cannot run (restricted CI sandboxes), use the zero-dependency Node
harness, which applies the same NFR thresholds:

```bash
node tests/perf/local-bench.mjs                 # full profile vs NFRs
node tests/perf/local-bench.mjs --smoke         # 30s CI smoke profile
```
