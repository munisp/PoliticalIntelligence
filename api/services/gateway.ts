import type { Context, Next } from "hono";
import {
  DOMAIN_REGISTRY,
  domainForRestPath,
  domainForTrpcPath,
  domainServiceUrl,
  getDomain,
} from "./index";

/**
 * API-9: api-gateway delegation.
 *
 * SERVICES_MODE=monolith (default): requests are handled in-process by the
 * monolith route table (boot.ts mounts rest + tRPC as before).
 *
 * SERVICES_MODE=micro: the gateway forwards /v1/* and /api/trpc/* to the
 * owning domain service (registry in api/services/index.ts; URLs from
 * SERVICE_URL_<DOMAIN> env, default http://localhost:30xx). Unknown paths
 * still fall through to the local handlers (e.g. /healthz, /metrics).
 */

export type ServicesMode = "monolith" | "micro";

export function servicesMode(env: NodeJS.ProcessEnv = process.env): ServicesMode {
  return env.SERVICES_MODE === "micro" ? "micro" : "monolith";
}

export interface ForwardOptions {
  fetchImpl?: typeof fetch;
}

/** Resolve the upstream URL for a request path, or null when unrouted. */
export function upstreamFor(path: string): string | null {
  const domain = domainForRestPath(path) ?? domainForTrpcPath(path);
  if (!domain) return null;
  return domainServiceUrl(getDomain(domain));
}

async function forward(
  c: Context,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const url = new URL(c.req.url);
  const base = upstreamFor(url.pathname);
  if (!base) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: `no domain service owns ${url.pathname}`,
          request_id: "unknown",
          retryable: false,
        },
      },
      404,
    );
  }
  const target = `${base}${url.pathname}${url.search}`;
  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");
  headers.set("x-forwarded-host", url.host);
  headers.set("x-gateway", "policy-twin-api-gateway");
  const hasBody = !["GET", "HEAD"].includes(c.req.method);
  const init: RequestInit & { duplex?: "half" } = {
    method: c.req.method,
    headers,
    body: hasBody ? (c.req.raw.body as unknown as RequestInit["body"]) : undefined,
  };
  if (hasBody) init.duplex = "half"; // Node fetch requires duplex for stream bodies
  const resp = await fetchImpl(target, init);
  return new Response(resp.body, {
    status: resp.status,
    headers: resp.headers,
  });
}

/**
 * Hono middleware mounted before the in-process handlers. In micro mode it
 * forwards /v1/* and /api/trpc/* to domain services; in monolith mode it is
 * a pass-through.
 */
export function gatewayDelegation(opts: ForwardOptions = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async (c: Context, next: Next) => {
    if (servicesMode() !== "micro") return next();
    const path = new URL(c.req.url).pathname;
    if (!path.startsWith("/v1/") && !path.startsWith("/api/trpc/")) {
      return next();
    }
    return forward(c, fetchImpl);
  };
}

/** Exposed for tests/ops: summary of the active decomposition. */
export function gatewayRouteTable() {
  return Object.values(DOMAIN_REGISTRY).map((spec) => ({
    domain: spec.name,
    port: spec.port,
    urlEnv: spec.urlEnv,
    trpcKeys: spec.trpcKeys,
  }));
}
