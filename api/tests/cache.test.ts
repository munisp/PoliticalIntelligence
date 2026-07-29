import { beforeEach, describe, expect, it } from "vitest";
import {
  cached,
  cacheGet,
  cacheSet,
  cacheDel,
  __clearMemoryCache,
} from "../utils/cache";

/**
 * Cache utility tests (docs/REDIS.md). REDIS_URL is unset in the test env,
 * so these exercise the in-process Map fallback — the same code path the
 * API takes when Redis is unavailable.
 */

describe("cache (in-process fallback)", () => {
  beforeEach(() => __clearMemoryCache());

  it("miss → fn executes, result stored; hit → fn skipped", async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return { n: calls };
    };
    const first = await cached("k1", 60, fn);
    expect(first).toEqual({ n: 1 });
    const second = await cached("k1", 60, fn);
    expect(second).toEqual({ n: 1 }); // served from cache
    expect(calls).toBe(1);
  });

  it("cacheSet/cacheGet round-trip and cacheDel", async () => {
    await cacheSet("k2", JSON.stringify([1, 2, 3]), 60);
    expect(JSON.parse((await cacheGet("k2"))!)).toEqual([1, 2, 3]);
    await cacheDel("k2");
    expect(await cacheGet("k2")).toBeNull();
  });

  it("expires entries after the TTL", async () => {
    let calls = 0;
    const fn = async () => ++calls;
    // TTL 0s → coerced to 1s floor in Redis path; memory path expires
    // immediately at ttl*1000 = 0, so the second call re-executes.
    await cached("k3", 0, fn);
    await new Promise((r) => setTimeout(r, 5));
    await cached("k3", 0, fn);
    expect(calls).toBe(2);
  });

  it("treats corrupt cached payloads as a miss and overwrites", async () => {
    await cacheSet("k4", "not-json{{{", 60);
    let calls = 0;
    const v = await cached("k4", 60, async () => {
      calls += 1;
      return "fresh";
    });
    expect(v).toBe("fresh");
    expect(calls).toBe(1);
    expect(JSON.parse((await cacheGet("k4"))!)).toBe("fresh");
  });

  it("falls back to memory when REDIS_URL is unset (no throw)", async () => {
    delete process.env.REDIS_URL;
    await expect(cached("k5", 60, async () => "ok")).resolves.toBe("ok");
  });
});
