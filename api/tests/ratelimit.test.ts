import { describe, expect, it } from "vitest";
import { createSlidingWindowLimiter } from "../utils/ratelimit";

/**
 * Sliding-window limiter tests (docs/REDIS.md). REDIS_URL is unset in the
 * test env, exercising the in-memory sliding-window path; the Redis path
 * uses the same semantics via an atomic Lua script.
 */

describe("sliding-window rate limiter", () => {
  it("allows up to the limit within the window, then rejects", async () => {
    const rl = createSlidingWindowLimiter({ windowMs: 1_000, limit: 3, prefix: "t1" });
    const t0 = 1_000_000;
    for (let i = 1; i <= 3; i++) {
      const d = await rl.hit("client", t0 + i);
      expect(d.allowed).toBe(true);
      expect(d.used).toBe(i);
    }
    const denied = await rl.hit("client", t0 + 4);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it("window slides: old requests age out and capacity returns", async () => {
    const rl = createSlidingWindowLimiter({ windowMs: 100, limit: 2, prefix: "t2" });
    const t0 = 2_000_000;
    expect((await rl.hit("c", t0)).allowed).toBe(true);
    expect((await rl.hit("c", t0 + 50)).allowed).toBe(true);
    expect((await rl.hit("c", t0 + 90)).allowed).toBe(false);
    // At t0+101 the first request has aged out → allowed again.
    const d = await rl.hit("c", t0 + 101);
    expect(d.allowed).toBe(true);
  });

  it("tracks keys independently", async () => {
    const rl = createSlidingWindowLimiter({ windowMs: 1_000, limit: 1, prefix: "t3" });
    const t0 = 3_000_000;
    expect((await rl.hit("a", t0)).allowed).toBe(true);
    expect((await rl.hit("a", t0 + 1)).allowed).toBe(false);
    expect((await rl.hit("b", t0 + 1)).allowed).toBe(true);
  });

  it("retryAfterMs reflects when the oldest in-window request expires", async () => {
    const rl = createSlidingWindowLimiter({ windowMs: 500, limit: 1, prefix: "t4" });
    const t0 = 4_000_000;
    await rl.hit("k", t0);
    const denied = await rl.hit("k", t0 + 200);
    expect(denied.retryAfterMs).toBe(300);
  });
});
