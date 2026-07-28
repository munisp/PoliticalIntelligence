import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createContext } from "../context";
import { buildRestApp } from "../rest";
import { getDomain, type DomainName } from "./index";

/**
 * API-9: build a Hono app for a single domain service. The app mounts ONLY:
 *   - /healthz, /metrics        (shared platform middleware)
 *   - /api/trpc/<domainKey>.*   (domain-scoped tRPC router)
 *   - /v1/<domain routes>       (domain REST mount)
 * Everything else 404s — this is the route-table isolation the spec §14
 * decomposition requires, with zero logic duplication (same router modules
 * and REST handlers as the monolith gateway).
 */
export function buildDomainApp(name: DomainName): Hono<{ Bindings: HttpBindings }> {
  const spec = getDomain(name);
  const app = new Hono<{ Bindings: HttpBindings }>();

  app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

  app.use("*", async (c, next) => {
    const start = performance.now();
    await next();
    const { observeHttp } = await import("../utils/metrics");
    observeHttp(
      c.req.routePath || c.req.path,
      c.req.method,
      c.res.status,
      (performance.now() - start) / 1000,
    );
  });

  app.get("/healthz", async (c) => {
    const base = { service: name, api_version: "v1", ts: new Date().toISOString() };
    try {
      const { getDb } = await import("../queries/connection");
      const { sql } = await import("drizzle-orm");
      await getDb().execute(sql`select 1`);
      return c.json({ status: "ok", db: "up", ...base }, 200);
    } catch {
      return c.json({ status: "degraded", db: "down", ...base }, 503);
    }
  });

  app.get("/metrics", async (c) => {
    const { renderMetrics } = await import("../utils/metrics");
    return c.text(renderMetrics(), 200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    });
  });

  const domainRouter = spec.buildTrpcRouter();
  app.use("/api/trpc/*", async (c) => {
    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req: c.req.raw,
      router: domainRouter,
      createContext,
    });
  });

  // NOTE: rest.ts imports appRouter for its default export, but the route
  // table here is limited to this domain's mount only.
  app.route("/v1", buildRestApp([spec.restMount]));

  app.all("*", (c) =>
    c.json(
      { error: { code: "NOT_FOUND", message: `not served by domain '${name}'`, request_id: "unknown", retryable: false } },
      404,
    ),
  );

  return app;
}

/** Start a domain service on its registry port (used by the boot files). */
export async function serveDomain(name: DomainName): Promise<void> {
  const spec = getDomain(name);
  const app = buildDomainApp(name);
  const { serve } = await import("@hono/node-server");
  const port = parseInt(process.env.PORT || String(spec.port), 10);
  serve({ fetch: app.fetch, port }, () => {
    console.log(`[${name}] domain service on http://localhost:${port}/ (trpc: ${spec.trpcKeys.join(",")})`);
  });
}
