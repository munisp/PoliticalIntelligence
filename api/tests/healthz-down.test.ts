import { describe, expect, it, vi } from "vitest";

/**
 * healthz DB-down path: the readiness probe must degrade to 503 when the
 * SELECT 1 probe fails (mocked connection).
 */

vi.mock("../queries/connection", () => ({
  getDb: () => ({
    execute: async () => {
      throw new Error("simulated db outage");
    },
  }),
}));

const { default: app } = await import("../boot");

describe("healthz readiness probe (db down)", () => {
  it("GET /healthz returns 503 degraded when the DB probe fails", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.status).toBe("degraded");
    expect(body.db).toBe("down");
  });
});
