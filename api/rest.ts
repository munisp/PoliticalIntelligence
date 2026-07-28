import { Hono, type Context } from "hono";
import { TRPCError } from "@trpc/server";
import { appRouter } from "./router";
import type { TrpcContext } from "./context";
import { authenticateRequest } from "./kimi/auth";
import type { ErrorEnvelope } from "@contracts/entities";
import { envelope } from "./utils/envelope";
import {
  mountAdminRest,
  mountBriefsRest,
  mountDocumentsGatewayRest,
  mountJurisdictionsRest,
  mountLegislationRest,
  mountOpportunitiesRest,
  mountOpsRest,
  mountScenariosRest,
  type RestDeps,
  type RestMount,
} from "./services/rest-domains";

/**
 * Canonical REST /v1 facade (docs/API.md) over the same procedures the tRPC
 * router exposes. Same envelope + error envelope; RBAC/ABAC identical
 * because the handlers are shared.
 *
 * API-9: the route table is composed from per-domain mounts
 * (api/services/rest-domains.ts) — the monolith mounts ALL of them, each
 * domain service (api/services/<domain>.ts) mounts only its own.
 */

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

/** Shared deps handed to every domain REST mount. */
const REST_DEPS: RestDeps = {
  handle,
  requireIdempotencyKey,
  num,
  envelope,
};

/** All domain mounts, in stable order (monolith gateway route table). */
export const ALL_REST_MOUNTS: RestMount[] = [
  mountAdminRest,
  mountJurisdictionsRest,
  mountOpportunitiesRest,
  mountScenariosRest,
  mountLegislationRest,
  mountBriefsRest,
  mountDocumentsGatewayRest,
  mountOpsRest,
];

/** Build a REST /v1 app from an explicit set of domain mounts. */
export function buildRestApp(mounts: RestMount[]): Hono {
  const app = new Hono();
  for (const mount of mounts) mount(app, REST_DEPS);
  return app;
}

const rest = buildRestApp(ALL_REST_MOUNTS);

export default rest;
