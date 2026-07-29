/**
 * Sliding-window rate limiter (docs/REDIS.md).
 *
 * Backend order:
 *  1. Redis (REDIS_URL + optional `ioredis`): a true sliding window per key
 *     via a sorted set (ZREMRANGEBYSCORE → ZADD(now) → ZCARD → PEXPIRE),
 *     executed atomically with a Lua script. Correct across replicas.
 *  2. In-process fallback: a per-key array of request timestamps pruned to
 *     the window — correct for single-replica dev and unit tests.
 *
 * `hit()` returns the sliding-window decision; it never throws (backend
 * errors fall back to the in-memory path, fail-open for availability).
 */

import { getRedis } from "./cache";

export interface RateLimitResult {
  allowed: boolean;
  /** Requests used in the current window (after this call). */
  used: number;
  limit: number;
  /** Epoch ms when the oldest in-window request ages out. */
  retryAfterMs: number;
}

export interface SlidingLimiter {
  hit(key: string, now?: number): Promise<RateLimitResult>;
}

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = 0
  if oldest[2] then retry = math.max(0, (tonumber(oldest[2]) + window) - now) end
  return {0, count, retry}
end
redis.call('ZADD', key, now, tostring(now) .. ':' .. tostring(math.random()))
redis.call('PEXPIRE', key, window)
return {1, count + 1, 0}
`;

/** Create a sliding-window limiter (window ms, max requests per window). */
export function createSlidingWindowLimiter(opts: {
  windowMs: number;
  limit: number;
  /** Key prefix to namespace distinct limiters (e.g. "embed"). */
  prefix?: string;
}): SlidingLimiter {
  const { windowMs, limit } = opts;
  const prefix = opts.prefix ?? "rl";
  // In-process fallback state: key -> sorted ascending timestamps (ms).
  const memory = new Map<string, number[]>();

  function memoryHit(key: string, now: number): RateLimitResult {
    const cutoff = now - windowMs;
    const arr = (memory.get(key) ?? []).filter((t) => t > cutoff);
    if (arr.length >= limit) {
      memory.set(key, arr);
      return {
        allowed: false,
        used: arr.length,
        limit,
        retryAfterMs: Math.max(0, arr[0]! + windowMs - now),
      };
    }
    arr.push(now);
    memory.set(key, arr);
    // Bound the map: drop fully-expired keys lazily.
    if (memory.size > 10_000) {
      for (const [k, v] of memory) {
        if (v.length === 0 || v[v.length - 1]! <= cutoff) memory.delete(k);
      }
    }
    return { allowed: true, used: arr.length, limit, retryAfterMs: 0 };
  }

  return {
    async hit(key: string, now = Date.now()): Promise<RateLimitResult> {
      const redisKey = `${prefix}:${key}`;
      const redis = await getRedis();
      if (redis) {
        try {
          const res = (await redis.eval(
            SLIDING_WINDOW_LUA,
            1,
            redisKey,
            now,
            windowMs,
            limit,
          )) as [number, number, number];
          return {
            allowed: res[0] === 1,
            used: Number(res[1]),
            limit,
            retryAfterMs: Number(res[2]),
          };
        } catch (err) {
          console.error("[ratelimit] redis path failed, in-memory fallback:", err);
        }
      }
      return memoryHit(redisKey, now);
    },
  };
}

/** Test hook for the memory fallback path of a limiter (fresh instance). */
export function __createMemoryLimiterForTests(opts: {
  windowMs: number;
  limit: number;
}): SlidingLimiter {
  return createSlidingWindowLimiter(opts);
}
