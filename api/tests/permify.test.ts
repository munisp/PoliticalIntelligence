import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  checkAccess,
  permifyEnabled,
  resetPermifyBreaker,
  type AccessDecision,
} from "../utils/permify";

/**
 * Permify ReBAC integration (feat-mw-edge-authz): model shape, circuit-
 * breaker fallback, and checkAccess parity vs the ABAC fallback path with
 * mocked Permify responses.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

function stubPermify(handler: (url: string, body: any) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init: any) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      const result = handler(String(url), body);
      if (result instanceof Error) throw result;
      return {
        ok: true,
        status: 200,
        json: async () => result,
      } as Response;
    }),
  );
}

describe("permify schema model (infra/permify/schema.perm)", () => {
  const model = readFileSync(
    path.join(ROOT, "infra/permify/schema.perm"),
    "utf8",
  );

  it("declares the core entities", () => {
    for (const entity of [
      "user",
      "jurisdiction",
      "dataset",
      "law",
      "opportunity",
    ]) {
      expect(model).toMatch(new RegExp(`entity ${entity} \\{`));
    }
  });

  it("jurisdiction hierarchy: parent relation + recursive view", () => {
    expect(model).toContain("relation parent @jurisdiction");
    expect(model).toMatch(/permission view = admin or parent\.view/);
  });

  it("dataset read respects owner, jurisdiction view and classification", () => {
    expect(model).toContain("relation owner @user");
    expect(model).toContain("relation jur @jurisdiction");
    expect(model).toContain("attribute classification string");
    expect(model).toMatch(
      /permission read = is_public\(classification\) or owner or jur\.view/,
    );
  });

  it("law and opportunity expose read/write permissions", () => {
    for (const block of model.split("entity ").slice(1)) {
      if (/^(law|opportunity)/.test(block)) {
        expect(block).toContain("permission read =");
        expect(block).toContain("permission write =");
      }
    }
  });
});

describe("api/utils/permify checkAccess", () => {
  beforeEach(() => {
    resetPermifyBreaker();
    process.env.PERMIFY_URL = "http://permify.test:3476";
    delete process.env.PERMIFY_TENANT_ID;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PERMIFY_URL;
  });

  it("is disabled without PERMIFY_URL and uses the fallback directly", async () => {
    delete process.env.PERMIFY_URL;
    expect(permifyEnabled()).toBe(false);
    const fallback = vi.fn(async () => true);
    const d = await checkAccess(
      { id: 1 },
      "read",
      { type: "dataset", id: "ds1" },
      fallback,
    );
    expect(d).toEqual({ allowed: true, engine: "abac-fallback" });
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("calls the Permify REST check endpoint with the right shape", async () => {
    let seen: any;
    stubPermify((url, body) => {
      seen = { url, body };
      return { can: "RESULT_ALLOWED" };
    });
    const d = await checkAccess(
      { id: 42, role: "policy_analyst" },
      "read",
      { type: "dataset", id: "gdp-2024", attributes: { classification: "internal" } },
      async () => false,
    );
    expect(d.engine).toBe("permify");
    expect(d.allowed).toBe(true);
    expect(seen.url).toBe(
      "http://permify.test:3476/v1/tenants/t1/permissions/check",
    );
    expect(seen.body.entity).toEqual({ type: "dataset", id: "gdp-2024" });
    expect(seen.body.permission).toBe("read");
    expect(seen.body.subject).toEqual({ type: "user", id: "42" });
  });

  it("parity: Permify ALLOW/DENY maps to allowed true/false without fallback", async () => {
    for (const [can, allowed] of [
      ["RESULT_ALLOWED", true],
      ["RESULT_DENIED", false],
    ] as const) {
      resetPermifyBreaker();
      stubPermify(() => ({ can }));
      const fallback = vi.fn(async () => !allowed);
      const d = await checkAccess(
        { id: 7 },
        "read",
        { type: "dataset", id: "ds" },
        fallback,
      );
      expect(d.allowed).toBe(allowed);
      expect(d.engine).toBe("permify");
      expect(fallback).not.toHaveBeenCalled();
    }
  });

  it("falls back to ABAC when Permify errors, tagging the decision", async () => {
    stubPermify(() => new Error("connection refused"));
    const d = await checkAccess(
      { id: 7 },
      "read",
      { type: "dataset", id: "ds" },
      async () => true,
    );
    expect(d.engine).toBe("abac-fallback");
    expect(d.allowed).toBe(true);
    expect(d.permifyError).toContain("connection refused");
  });

  it("opens the circuit breaker after repeated failures (no further calls)", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("boom");
    });
    vi.stubGlobal("fetch", fetchMock);
    const fallback = vi.fn(async () => false);
    const results: AccessDecision[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(
        await checkAccess(
          { id: 1 },
          "read",
          { type: "dataset", id: "ds" },
          fallback,
        ),
      );
    }
    // 3 failures trip the breaker; the last 2 calls short-circuit.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fallback).toHaveBeenCalledTimes(5);
    expect(results.every((r) => r.engine === "abac-fallback")).toBe(true);
  });
});
