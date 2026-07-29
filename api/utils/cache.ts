/**
 * Cache utility (docs/REDIS.md).
 *
 * Delivery order:
 *  1. If REDIS_URL is set and the optional `ioredis` dependency is
 *     installed, use Redis (client cached per process, lazy connect).
 *  2. Otherwise (or on Redis failure) fall back to an in-process Map with
 *     TTL expiry — correct for single-replica dev and unit tests.
 *
 * `cached(key, ttlSeconds, fn)` is the read-through helper: cache hit
 * returns the stored JSON payload, miss executes `fn`, stores the result,
 * and returns it. Failures of the cache itself never propagate into the
 * caller — the underlying query always remains the source of truth.
 */

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  eval(...args: unknown[]): Promise<unknown>;
  quit(): Promise<unknown>;
}

let redisPromise: Promise<RedisLike | null> | null = null;

/** Resolve the shared Redis client, or null when unavailable. */
export async function getRedis(): Promise<RedisLike | null> {
  if (!process.env.REDIS_URL) return null;
  redisPromise ??= (async () => {
    try {
      // Optional dependency: guard the import so the API runs without it
      // (same pattern as kafkajs in utils/events.ts).
      const mod = (await import("ioredis" as string).catch(() => null)) as {
        default?: new (url: string, opts?: unknown) => RedisLike;
        Redis?: new (url: string, opts?: unknown) => RedisLike;
      } | null;
      const RedisCtor = mod?.default ?? mod?.Redis;
      if (!RedisCtor) return null;
      const client = new RedisCtor(process.env.REDIS_URL!, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 2_000,
      });
      return client;
    } catch (err) {
      console.error("[cache] redis init failed, using in-process Map:", err);
      return null;
    }
  })();
  return redisPromise;
}

/** Test hook: drop the cached client promise. */
export function __resetRedisForTests(): void {
  redisPromise = null;
}

/* ------------------------- in-process fallback ------------------------ */

const memoryStore = new Map<string, { value: string; expiresAt: number }>();
const MEMORY_MAX_KEYS = 1_000;

function memoryGet(key: string): string | null {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

function memorySet(key: string, value: string, ttlSeconds: number): void {
  // Bound the fallback store: evict expired entries (or the oldest) when
  // the cap is hit so a long-lived process cannot grow it without limit.
  if (memoryStore.size >= MEMORY_MAX_KEYS && !memoryStore.has(key)) {
    const now = Date.now();
    for (const [k, v] of memoryStore) {
      if (v.expiresAt <= now) memoryStore.delete(k);
    }
    if (memoryStore.size >= MEMORY_MAX_KEYS) {
      const oldest = memoryStore.keys().next().value;
      if (oldest !== undefined) memoryStore.delete(oldest);
    }
  }
  memoryStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/** Test hook: clear the in-process fallback store. */
export function __clearMemoryCache(): void {
  memoryStore.clear();
}

/* ------------------------------ API ---------------------------------- */

export async function cacheGet(key: string): Promise<string | null> {
  const redis = await getRedis();
  if (redis) {
    try {
      return await redis.get(key);
    } catch (err) {
      console.error("[cache] redis GET failed, falling back to memory:", err);
    }
  }
  return memoryGet(key);
}

export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.set(key, value, "EX", Math.max(1, Math.floor(ttlSeconds)));
      return;
    } catch (err) {
      console.error("[cache] redis SET failed, falling back to memory:", err);
    }
  }
  memorySet(key, value, ttlSeconds);
}

export async function cacheDel(...keys: string[]): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.del(...keys);
    } catch (err) {
      console.error("[cache] redis DEL failed:", err);
    }
  }
  for (const k of keys) memoryStore.delete(k);
}

/**
 * Read-through cache helper. `fn` result is JSON-serialized under `key`
 * for `ttlSeconds`. When the cache errors, `fn` still runs — the cache is
 * an optimization, never a correctness dependency.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  const hit = await cacheGet(key);
  if (hit !== null) {
    try {
      return JSON.parse(hit) as T;
    } catch {
      // Corrupt payload: treat as a miss and overwrite below.
    }
  }
  const value = await fn();
  await cacheSet(key, JSON.stringify(value), ttlSeconds);
  return value;
}
