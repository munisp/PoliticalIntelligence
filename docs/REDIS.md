# Redis runbook — cache + rate limiting

## What uses it

| Surface | Key pattern | TTL / window |
|---|---|---|
| `sectors.metrics` (tRPC) | `sectors:metrics:{jur}:{sector}:{from}:{to}` | 300 s |
| `geo.facilitiesNear` | `geo:facilitiesNear:{input-json}` | 120 s |
| `advocacy.stakeholderMap` | `advocacy:stakeholders:all`, `advocacy:edges:all` | 300 s |
| Embed router rate limit | `embed:{ip-hash}` (ZSET sliding window) | 60 req / 60 s |

Implementation: `api/utils/cache.ts` (`cached()`, `cacheGet/Set/Del`) and
`api/utils/ratelimit.ts` (`createSlidingWindowLimiter`, atomic Lua ZSET
script). `ioredis` is an **optional dependency** — when `REDIS_URL` is unset
or the client is missing, both utilities fall back to bounded in-process
implementations (TTL'd Map / timestamp arrays), so dev and tests need no
Redis.

## Run it

```bash
# compose (service `redis:7-alpine`, AOF on, port 6379)
docker compose -f infra/docker/docker-compose.yml up -d redis
export REDIS_URL=redis://localhost:6379
```

Kubernetes: `infra/k8s/base/redis.yaml` — dev single replica, Recreate
strategy, emptyDir (cache-only), 256mb allkeys-lru. `platform-config`
ConfigMap carries `REDIS_URL`.

## Operate

- **Verify:** `redis-cli ping` → `PONG`; `redis-cli info keyspace` to see cache keys.
- **Flush a stale read model:** `redis-cli --scan --pattern 'sectors:*' | xargs redis-cli del`
  (safe — next request repopulates from MySQL).
- **Memory:** evictions are expected (`allkeys-lru`); a rising
  `evicted_keys` means raise `maxmemory` or shorten TTLs, never correctness.
- **Outage behavior:** cache/limiter calls fail over to the in-process
  path and log `[cache]`/`[ratelimit]` errors; the API keeps serving from
  MySQL. At multi-replica scale a Redis outage degrades the embed limiter
  to per-instance windows (fail-open).

## Test

`npx vitest run api/tests/cache.test.ts api/tests/ratelimit.test.ts`
