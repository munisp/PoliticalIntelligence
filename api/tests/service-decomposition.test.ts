import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { buildDomainApp } from "../services/boot-domain";
import {
  DOMAIN_NAMES,
  DOMAIN_REGISTRY,
  domainForRestPath,
  domainForTrpcPath,
  getDomain,
} from "../services";
import { gatewayDelegation, servicesMode, upstreamFor } from "../services/gateway";

/**
 * API-9 (spec §14): service decomposition.
 *
 * - Each domain boot exposes ONLY its domain's routes (route-table assertions).
 * - The gateway delegates to domain services in micro mode and is a
 *   pass-through in monolith mode (default).
 */

function routePaths(app: Hono<any>): string[] {
  // Hono exposes the flat route table on app.routes
  return app.routes.map((r) => `${r.method} ${r.path}`);
}

const EXPECTED_V1: Record<string, string[]> = {
  jurisdictions: ["/v1/jurisdictions", "/v1/jurisdictions/:id/profile", "/v1/sectors"],
  opportunities: [
    "/v1/opportunities/rankings",
    "/v1/opportunities/generate",
    "/v1/jobs/:id",
    "/v1/search",
  ],
  scenarios: ["/v1/scenarios", "/v1/scenarios/:id/runs", "/v1/scenario-runs/:id"],
  legislation: [
    "/v1/legislation/laws",
    "/v1/legislation/graph-query",
    "/v1/legislation/compare",
  ],
  "documents-gateway": [],
  briefs: ["/v1/briefs/:id", "/v1/briefs"],
  admin: ["/v1/auth/me", "/v1/auth/permissions"],
  ops: ["/v1/health"],
};

describe("API-9 domain boots (route-table isolation)", () => {
  it("registry covers all 8 domain services with unique ports 30xx", () => {
    expect(DOMAIN_NAMES).toHaveLength(8);
    const ports = DOMAIN_NAMES.map((d) => DOMAIN_REGISTRY[d].port);
    expect(new Set(ports).size).toBe(8);
    for (const p of ports) expect(p).toBeGreaterThanOrEqual(3001);
    expect(pages()).toContain(3008);
    function pages() {
      return ports;
    }
  });

  for (const name of DOMAIN_NAMES) {
    it(`domain '${name}' exposes only its own /v1 routes`, () => {
      const app = buildDomainApp(name);
      const paths = routePaths(app);
      const v1 = paths.filter((p) => p.includes(" /v1/"));
      const expected = EXPECTED_V1[name]!;
      expect(v1.sort()).toEqual(
        expected
          .flatMap((p) => {
            const methods =
              name === "opportunities" && p === "/v1/opportunities/generate"
                ? ["POST"]
                : name === "scenarios" && (p === "/v1/scenarios" || p === "/v1/scenarios/:id/runs")
                  ? ["POST"]
                  : name === "legislation" && p !== "/v1/legislation/laws"
                    ? ["POST"]
                    : name === "briefs" && p === "/v1/briefs"
                      ? ["POST"]
                      : ["GET"];
            return methods.map((m) => `${m} ${p}`);
          })
          .sort(),
      );
      // every domain app still exposes platform middleware endpoints
      expect(paths).toContain("GET /healthz");
      expect(paths).toContain("GET /metrics");
      expect(paths.some((p) => p.includes("/api/trpc/"))).toBe(true);
    });
  }

  it("jurisdictions app does not serve briefs/legislation routes", async () => {
    const app = buildDomainApp("jurisdictions");
    const res = await app.request("/v1/briefs/brf_1");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("jurisdictions");
  });

  it("each domain tRPC router serves only its router keys", () => {
    for (const name of DOMAIN_NAMES) {
      const spec = getDomain(name);
      const router = spec.buildTrpcRouter();
      const keys = Object.keys(router._def.procedures as Record<string, unknown>)
        .map((p) => p.split(".")[0]!)
        .filter((v, i, a) => a.indexOf(v) === i);
      expect(keys.sort()).toEqual(["ping", ...spec.trpcKeys].sort());
    }
  });
});

describe("API-9 path → domain routing", () => {
  it("maps REST paths to owning domains", () => {
    expect(domainForRestPath("/v1/jurisdictions")).toBe("jurisdictions");
    expect(domainForRestPath("/v1/jurisdictions/jur:ng-kd/profile")).toBe("jurisdictions");
    expect(domainForRestPath("/v1/scenario-runs/sim:1")).toBe("scenarios");
    expect(domainForRestPath("/v1/legislation/compare")).toBe("legislation");
    expect(domainForRestPath("/v1/auth/me")).toBe("admin");
    expect(domainForRestPath("/v1/nope")).toBeNull();
  });

  it("maps tRPC paths to owning domains", () => {
    expect(domainForTrpcPath("/api/trpc/jurisdictions.list")).toBe("jurisdictions");
    expect(domainForTrpcPath("/api/trpc/documents.register")).toBe("documents-gateway");
    expect(domainForTrpcPath("/api/trpc/ops.health")).toBe("ops");
    expect(domainForTrpcPath("/api/trpc/ping")).toBe("ops");
  });

  it("resolves upstream URLs from env or registry port defaults", () => {
    expect(upstreamFor("/v1/briefs/brf_1")).toBe("http://localhost:3006");
    process.env.SERVICE_URL_BRIEFS = "http://briefs:3006";
    expect(upstreamFor("/v1/briefs")).toBe("http://briefs:3006");
    delete process.env.SERVICE_URL_BRIEFS;
  });
});

describe("API-9 gateway delegation", () => {
  afterEach(() => {
    delete process.env.SERVICES_MODE;
    vi.restoreAllMocks();
  });

  it("defaults to monolith mode", () => {
    expect(servicesMode({} as NodeJS.ProcessEnv)).toBe("monolith");
    expect(servicesMode({ SERVICES_MODE: "micro" } as NodeJS.ProcessEnv)).toBe("micro");
  });

  it("monolith mode: pass-through to in-process handlers", async () => {
    process.env.SERVICES_MODE = "monolith";
    const fetchMock = vi.fn();
    const app = new Hono();
    app.use("/v1/*", gatewayDelegation({ fetchImpl: fetchMock as never }));
    app.get("/v1/health", (c) => c.json({ local: true }));
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect((await res.json()) as { local: boolean }).toEqual({ local: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("micro mode: forwards /v1 to the owning domain service", async () => {
    process.env.SERVICES_MODE = "micro";
    process.env.SERVICE_URL_JURISDICTIONS = "http://jurisdictions:3001";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const app = new Hono();
    app.use("/v1/*", gatewayDelegation({ fetchImpl: fetchMock as never }));
    const res = await app.request("/v1/jurisdictions?limit=5");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://jurisdictions:3001/v1/jurisdictions?limit=5");
    expect(init.method).toBe("GET");
    expect((init.headers as Headers).get("x-gateway")).toBe("policy-twin-api-gateway");
    delete process.env.SERVICE_URL_JURISDICTIONS;
  });

  it("micro mode: forwards tRPC to the owning domain service", async () => {
    process.env.SERVICES_MODE = "micro";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const app = new Hono();
    app.use("/api/trpc/*", gatewayDelegation({ fetchImpl: fetchMock as never }));
    await app.request("/api/trpc/briefs.get?input=%7B%7D");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:3006/api/trpc/briefs.get?input=%7B%7D");
  });

  it("micro mode: non-delegated paths fall through (healthz/metrics/local)", async () => {
    process.env.SERVICES_MODE = "micro";
    const fetchMock = vi.fn();
    const app = new Hono();
    app.use("/v1/*", gatewayDelegation({ fetchImpl: fetchMock as never }));
    app.get("/healthz", (c) => c.text("ok"));
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("micro mode: unknown /v1 path returns 404 from the gateway", async () => {
    process.env.SERVICES_MODE = "micro";
    const fetchMock = vi.fn();
    const app = new Hono();
    app.use("/v1/*", gatewayDelegation({ fetchImpl: fetchMock as never }));
    const res = await app.request("/v1/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
