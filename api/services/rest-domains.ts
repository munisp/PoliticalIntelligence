import type { Context, Hono } from "hono";
import type { TrpcContext } from "../context";
import type { AppRouter } from "../router";

/**
 * API-9 (spec §14): per-domain REST /v1 route mounts.
 *
 * Each domain service (api/services/<domain>.ts) mounts ONLY the REST routes
 * that belong to its domain; the monolith gateway (api/rest.ts) mounts all of
 * them. Handlers are shared verbatim with the monolith — there is no logic
 * duplication, only route-table composition.
 *
 * Domain → REST ownership:
 *   jurisdictions     /jurisdictions*, /sectors
 *   opportunities     /opportunities*, /jobs/:id, /search
 *   scenarios         /scenarios*, /scenario-runs/:id
 *   legislation       /legislation/*
 *   documents-gateway (tRPC only — documents procedures proxy the documents
 *                      microservice; no dedicated REST routes today)
 *   briefs            /briefs*
 *   admin             /auth/*
 *   ops               /health
 */

export type Caller = ReturnType<AppRouter["createCaller"]>;

export interface RestDeps {
  handle: (
    fn: (c: Context, caller: Caller, ctx: TrpcContext) => Promise<Response>,
  ) => (c: Context) => Promise<Response>;
  requireIdempotencyKey: (c: Context) => {
    key: string | null;
    error: unknown;
  };
  num: (v: string | undefined) => number | undefined;
  envelope: (data: unknown, ctx: TrpcContext) => unknown;
}

export type RestMount = (app: Hono, deps: RestDeps) => void;

export const mountJurisdictionsRest: RestMount = (app, { handle, num, envelope }) => {
  void envelope; // uniform deps shape across mounts
  app.get("/jurisdictions", handle(async (c, caller) => {
    const data = await caller.jurisdictions.list({
      country_code: c.req.query("country_code"),
      admin_level: c.req.query("admin_level") as never,
      cursor: c.req.query("cursor"),
      limit: num(c.req.query("limit")) ?? 25,
    });
    return c.json(data, 200);
  }));

  app.get("/jurisdictions/:id/profile", handle(async (c, caller) => {
    const data = await caller.jurisdictions.profile({
      jurisdiction_id: c.req.param("id")!,
      profile_date: c.req.query("profile_date"),
    });
    return c.json(data, 200);
  }));

  app.get("/sectors", handle(async (c, caller) => {
    const data = await caller.sectors.list();
    return c.json(data, 200);
  }));
};

export const mountOpportunitiesRest: RestMount = (app, { handle, requireIdempotencyKey, num }) => {
  app.get("/opportunities/rankings", handle(async (c, caller) => {
    const data = await caller.opportunities.rankings({
      jurisdiction_id: c.req.query("jurisdiction_id"),
      sector_code: c.req.query("sector_code"),
      geography: c.req.query("geography"),
      horizon_max_months: num(c.req.query("horizon_max_months")),
      confidence_floor: num(c.req.query("confidence_floor")),
      cursor: c.req.query("cursor"),
      limit: num(c.req.query("limit")) ?? 25,
    });
    return c.json(data, 200);
  }));

  app.post("/opportunities/generate", handle(async (c, caller) => {
    const idk = requireIdempotencyKey(c);
    if (!idk.key) return c.json({ error: idk.error }, 400);
    const body = await c.req.json().catch(() => ({}));
    const data = await caller.opportunities.generate({
      opportunity_id: body.opportunity_id,
      idempotency_key: idk.key,
    });
    return c.json(data, 202);
  }));

  app.get("/jobs/:id", handle(async (c, caller) => {
    const data = await caller.opportunities.generateStatus({ job_id: c.req.param("id")! });
    return c.json(data, 200);
  }));

  app.get("/search", handle(async (c, caller) => {
    const data = await caller.search.query({
      q: c.req.query("q") ?? "-",
      jurisdiction_id: c.req.query("jurisdiction_id"),
      limit: num(c.req.query("limit")) ?? 20,
    });
    return c.json(data, 200);
  }));
};

export const mountScenariosRest: RestMount = (app, { handle, requireIdempotencyKey }) => {
  app.post("/scenarios", handle(async (c, caller) => {
    const idk = requireIdempotencyKey(c);
    if (!idk.key) return c.json({ error: idk.error }, 400);
    const body = await c.req.json().catch(() => ({}));
    const data = await caller.scenarios.create({ ...body, idempotency_key: idk.key });
    return c.json(data, 202);
  }));

  app.post("/scenarios/:id/runs", handle(async (c, caller) => {
    const idk = requireIdempotencyKey(c);
    if (!idk.key) return c.json({ error: idk.error }, 400);
    const body = await c.req.json().catch(() => ({}));
    const data = await caller.scenarios.addRun({
      ...body,
      scenario_id: c.req.param("id")!,
      idempotency_key: idk.key,
    });
    return c.json(data, 202);
  }));

  app.get("/scenario-runs/:id", handle(async (c, caller) => {
    const data = await caller.scenarios.runStatus({ simulation_run_id: c.req.param("id")! });
    return c.json(data, 200);
  }));
};

export const mountLegislationRest: RestMount = (app, { handle, num }) => {
  app.get("/legislation/laws", handle(async (c, caller) => {
    const data = await caller.legislation.laws({
      jurisdiction_id: c.req.query("jurisdiction_id"),
      category: c.req.query("category"),
      cursor: c.req.query("cursor"),
      limit: num(c.req.query("limit")) ?? 25,
    });
    return c.json(data, 200);
  }));

  app.post("/legislation/graph-query", handle(async (c, caller) => {
    const body = await c.req.json().catch(() => ({}));
    const data = await caller.legislation.graphQuery(body);
    return c.json(data, 200);
  }));

  // SR-8: clause-level law comparison (deterministic alignment engine).
  app.post("/legislation/compare", handle(async (c, caller) => {
    const body = await c.req.json().catch(() => ({}));
    const data = await caller.legislation.compare({
      law_id_a: body.law_id_a,
      law_id_b: body.law_id_b,
    });
    return c.json(data, 200);
  }));
};

export const mountBriefsRest: RestMount = (app, { handle, requireIdempotencyKey }) => {
  app.get("/briefs/:id", handle(async (c, caller) => {
    const data = await caller.briefs.get({ brief_id: c.req.param("id")! });
    return c.json(data, 200);
  }));

  app.post("/briefs", handle(async (c, caller) => {
    const idk = requireIdempotencyKey(c);
    if (!idk.key) return c.json({ error: idk.error }, 400);
    const body = await c.req.json().catch(() => ({}));
    const data = await caller.briefs.generate({
      ...body,
      idempotency_key: idk.key,
    });
    return c.json(data, 202);
  }));
};

export const mountAdminRest: RestMount = (app, { handle, envelope }) => {
  app.get("/auth/me", handle(async (c, caller, ctx) => {
    const user = await caller.auth.me();
    return c.json(envelope(user, ctx), 200);
  }));

  app.get("/auth/permissions", handle(async (c, caller) => {
    const data = await caller.auth.permissions();
    return c.json(data, 200);
  }));
};

export const mountOpsRest: RestMount = (app, { handle }) => {
  app.get("/health", handle(async (c, caller) => {
    const data = await caller.ops.health();
    return c.json(data, 200);
  }));
};

/** documents-gateway exposes no dedicated REST routes today (tRPC only). */
export const mountDocumentsGatewayRest: RestMount = () => {};
