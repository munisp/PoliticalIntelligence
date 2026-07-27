import { describe, expect, it } from "vitest";
import app from "../boot";

/**
 * Contract tests for the canonical REST /v1 facade (docs/API.md).
 * Uses Hono's app.request — no network listener needed. Requires the seeded
 * dev database (DATABASE_URL in .env).
 */

describe("REST /v1 facade", () => {
  it("GET /healthz returns 200 json", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("ok");
  });

  it("GET /v1/health returns the standard envelope", async () => {
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.status).toBe("ok");
    expect(body.meta.api_version).toBe("v1");
    expect(body.meta.request_id).toMatch(/^req_/);
    expect(body.audit).toBeDefined();
  });

  it("GET /v1/jurisdictions lists seeded jurisdictions", async () => {
    const res = await app.request("/v1/jurisdictions?country_code=NG");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.data.items)).toBe(true);
    expect(body.data.items.length).toBeGreaterThanOrEqual(3);
    expect(body.data.items.some((j: { jurisdictionId: string }) => j.jurisdictionId === "jur:ng-kd")).toBe(true);
  });

  it("GET /v1/jurisdictions/:id/profile returns profile with scores", async () => {
    const res = await app.request("/v1/jurisdictions/jur:ng-kd/profile");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.jurisdiction.jurisdictionId).toBe("jur:ng-kd");
    expect(body.data.summary).toBeDefined();
    expect(body.data.scores).toBeDefined();
  });

  it("GET /v1/opportunities/rankings returns ranked items", async () => {
    const res = await app.request("/v1/opportunities/rankings?jurisdiction_id=jur:ng-kd");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.data.items)).toBe(true);
    expect(body.data.items.length).toBeGreaterThan(0);
    expect(body.data.items[0].confidence_tier).toMatch(/high|medium|low/);
  });

  it("POST /v1/opportunities/generate requires Idempotency-Key", async () => {
    const res = await app.request("/v1/opportunities/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opportunity_id: "opp:edu:digital-classroom-assistants" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("POST /v1/opportunities/generate without auth returns error envelope 401", async () => {
    const res = await app.request("/v1/opportunities/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "rest-test-key-0001",
      },
      body: JSON.stringify({ opportunity_id: "opp:edu:digital-classroom-assistants" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("GET /v1/jobs/:id requires auth (401 error envelope anonymous)", async () => {
    const res = await app.request("/v1/jobs/job:does-not-exist");
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.retryable).toBe(false);
  });

  it("GET /v1/legislation/laws lists laws", async () => {
    const res = await app.request("/v1/legislation/laws");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.items.length).toBeGreaterThan(0);
  });

  it("POST /v1/legislation/graph-query walks the citation graph", async () => {
    const res = await app.request("/v1/legislation/graph-query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed_law_id: "law:ng:ppa-2007", depth: 2 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toBeDefined();
  });

  it("GET /v1/search returns fused results with provenance", async () => {
    const res = await app.request("/v1/search?q=teacher");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.data.results)).toBe(true);
    expect(body.data.results.length).toBeGreaterThan(0);
    expect(body.data.results[0].provenance).toBeDefined();
  });

  it("GET /v1/scenario-runs/:id returns run status", async () => {
    const res = await app.request("/v1/scenario-runs/sim:001");
    expect([200, 404]).toContain(res.status);
  });

  it("GET /metrics exposes Prometheus text with request histogram", async () => {
    await app.request("/v1/health"); // generate an observation
    const res = await app.request("/metrics");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("http_request_duration_seconds_bucket");
    expect(text).toContain("jobs_total");
    expect(text).toContain("simulation_runs_total");
    expect(text).toContain("llm_routing_decisions_total");
    expect(text).toContain("ingestion_records_total");
  });
});
