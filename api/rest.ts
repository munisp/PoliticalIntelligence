import { Hono, type Context } from "hono";
import { TRPCError } from "@trpc/server";
import { appRouter } from "./router";
import type { TrpcContext } from "./context";
import { authenticateRequest } from "./kimi/auth";
import type { ErrorEnvelope } from "@contracts/entities";
import { envelope } from "./utils/envelope";

/**
 * Canonical REST /v1 facade (docs/API.md) over the same procedures the tRPC
 * router exposes. Same envelope + error envelope; RBAC/ABAC identical
 * because the handlers are shared.
 */

const rest = new Hono();

const HTTP_STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
};

async function buildCtx(raw: Request): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: raw, resHeaders: new Headers() };
  try {
    ctx.user = await authenticateRequest(raw.headers);
  } catch {
    // optional auth — public endpoints stay anonymous
  }
  return ctx;
}

function callerFor(ctx: TrpcContext) {
  return appRouter.createCaller(ctx);
}

function toRestError(c: Context, err: unknown): Response {
  if (err instanceof TRPCError) {
    const status = (HTTP_STATUS[err.code] ?? 500) as 400;
    const cause = err.cause as ErrorEnvelope | undefined;
    return c.json(
      {
        error: cause ?? {
          code: err.code,
          message: err.message,
          request_id: "unknown",
          retryable: false,
        },
      },
      status,
    );
  }
  const status = 500 as const;
  return c.json(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: err instanceof Error ? err.message : "Unexpected error",
        request_id: "unknown",
        retryable: true,
      } satisfies ErrorEnvelope,
    },
    status,
  );
}

/** Wrap a handler with REST error mapping. */
function handle(
  fn: (
    c: Context,
    caller: ReturnType<typeof callerFor>,
    ctx: TrpcContext,
  ) => Promise<Response>,
) {
  return async (c: Context) => {
    try {
      const ctx = await buildCtx(c.req.raw);
      return await fn(c, callerFor(ctx), ctx);
    } catch (err) {
      return toRestError(c, err);
    }
  };
}

const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));

/**
 * Uniform Idempotency-Key enforcement for ALL mutating REST routes (API-5).
 * Returns the key when present (>= 8 chars); otherwise the standard error
 * envelope. Call sites:
 *   const idk = requireIdempotencyKey(c);
 *   if (!idk.key) return c.json({ error: idk.error }, 400);
 */
function requireIdempotencyKey(c: Context): {
  key: string | null;
  error: ErrorEnvelope | null;
} {
  const key = c.req.header("Idempotency-Key");
  if (!key || key.length < 8) {
    return {
      key: null,
      error: {
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key header (>= 8 chars) is required",
        request_id: "unknown",
        retryable: false,
      },
    };
  }
  return { key, error: null };
}

/* Auth (spec §7) ------------------------------------------------------------ */

rest.get("/auth/me", handle(async (c, caller, ctx) => {
  const user = await caller.auth.me();
  return c.json(envelope(user, ctx), 200);
}));

rest.get("/auth/permissions", handle(async (c, caller) => {
  const data = await caller.auth.permissions();
  return c.json(data, 200);
}));

rest.get("/jurisdictions", handle(async (c, caller) => {
  const data = await caller.jurisdictions.list({
    country_code: c.req.query("country_code"),
    admin_level: c.req.query("admin_level") as never,
    cursor: c.req.query("cursor"),
    limit: num(c.req.query("limit")) ?? 25,
  });
  return c.json(data, 200);
}));

rest.get("/jurisdictions/:id/profile", handle(async (c, caller) => {
  const data = await caller.jurisdictions.profile({
    jurisdiction_id: c.req.param("id")!,
    profile_date: c.req.query("profile_date"),
  });
  return c.json(data, 200);
}));

rest.get("/opportunities/rankings", handle(async (c, caller) => {
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

rest.post("/opportunities/generate", handle(async (c, caller) => {
  const idk = requireIdempotencyKey(c);
  if (!idk.key) return c.json({ error: idk.error }, 400);
  const body = await c.req.json().catch(() => ({}));
  const data = await caller.opportunities.generate({
    opportunity_id: body.opportunity_id,
    idempotency_key: idk.key,
  });
  return c.json(data, 202);
}));

rest.get("/jobs/:id", handle(async (c, caller) => {
  const data = await caller.opportunities.generateStatus({ job_id: c.req.param("id")! });
  return c.json(data, 200);
}));

rest.post("/scenarios", handle(async (c, caller) => {
  const idk = requireIdempotencyKey(c);
  if (!idk.key) return c.json({ error: idk.error }, 400);
  const body = await c.req.json().catch(() => ({}));
  const data = await caller.scenarios.create({ ...body, idempotency_key: idk.key });
  return c.json(data, 202);
}));

rest.post("/scenarios/:id/runs", handle(async (c, caller) => {
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

rest.get("/scenario-runs/:id", handle(async (c, caller) => {
  const data = await caller.scenarios.runStatus({ simulation_run_id: c.req.param("id")! });
  return c.json(data, 200);
}));

rest.get("/legislation/laws", handle(async (c, caller) => {
  const data = await caller.legislation.laws({
    jurisdiction_id: c.req.query("jurisdiction_id"),
    category: c.req.query("category"),
    cursor: c.req.query("cursor"),
    limit: num(c.req.query("limit")) ?? 25,
  });
  return c.json(data, 200);
}));

rest.post("/legislation/graph-query", handle(async (c, caller) => {
  const body = await c.req.json().catch(() => ({}));
  const data = await caller.legislation.graphQuery(body);
  return c.json(data, 200);
}));

// SR-8: clause-level law comparison (deterministic alignment engine).
rest.post("/legislation/compare", handle(async (c, caller) => {
  const body = await c.req.json().catch(() => ({}));
  const data = await caller.legislation.compare({
    law_id_a: body.law_id_a,
    law_id_b: body.law_id_b,
  });
  return c.json(data, 200);
}));

rest.get("/search", handle(async (c, caller) => {
  const data = await caller.search.query({
    q: c.req.query("q") ?? "-",
    jurisdiction_id: c.req.query("jurisdiction_id"),
    limit: num(c.req.query("limit")) ?? 20,
  });
  return c.json(data, 200);
}));

rest.get("/sectors", handle(async (c, caller) => {
  const data = await caller.sectors.list();
  return c.json(data, 200);
}));

rest.get("/briefs/:id", handle(async (c, caller) => {
  const data = await caller.briefs.get({ brief_id: c.req.param("id")! });
  return c.json(data, 200);
}));

rest.post("/briefs", handle(async (c, caller) => {
  const idk = requireIdempotencyKey(c);
  if (!idk.key) return c.json({ error: idk.error }, 400);
  const body = await c.req.json().catch(() => ({}));
  const data = await caller.briefs.generate({
    ...body,
    idempotency_key: idk.key,
  });
  return c.json(data, 202);
}));

rest.get("/health", handle(async (c, caller) => {
  const data = await caller.ops.health();
  return c.json(data, 200);
}));

export default rest;
