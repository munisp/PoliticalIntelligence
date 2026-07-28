import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { createOAuthCallbackHandler } from "./kimi/auth";
import { Paths } from "@contracts/constants";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

// Zero-dep HTTP metrics (Prometheus exposition at GET /metrics).
app.use("*", async (c, next) => {
  const start = performance.now();
  await next();
  const { observeHttp } = await import("./utils/metrics");
  observeHttp(
    c.req.routePath || c.req.path,
    c.req.method,
    c.res.status,
    (performance.now() - start) / 1000,
  );
});

// Liveness/readiness probe (compose healthcheck target). Readiness is real:
// a DB probe (SELECT 1) decides 200 vs 503 (API-6).
app.get("/healthz", async (c) => {
  const base = { api_version: "v1", ts: new Date().toISOString() };
  try {
    const { getDb } = await import("./queries/connection");
    const { sql } = await import("drizzle-orm");
    await getDb().execute(sql`select 1`);
    return c.json({ status: "ok", db: "up", ...base }, 200);
  } catch {
    return c.json({ status: "degraded", db: "down", ...base }, 503);
  }
});

// Prometheus scrape endpoint.
app.get("/metrics", async (c) => {
  const { renderMetrics } = await import("./utils/metrics");
  return c.text(renderMetrics(), 200, {
    "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
  });
});

app.get(Paths.oauthCallback, createOAuthCallbackHandler());
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

// Canonical REST /v1 facade (docs/API.md) — same procedures as tRPC.
const { default: rest } = await import("./rest");
app.route("/v1", rest);

// OpenTelemetry tracing (OBS-3): noop unless OTEL_SDK_ENABLED=true and the
// optional @opentelemetry/* packages are installed — see api/utils/otel.ts.
const { setupNodeOtel } = await import("./utils/otel");
await setupNodeOtel();

// Durable-outbox relay for the event backbone (noop without KAFKA_BROKERS).
const { startOutboxRelay } = await import("./utils/events");
startOutboxRelay();

// Event consumers + DLQ + job-heartbeat sweeper + WORM export interval
// (EVENT_CONSUMERS=0 disables; default on). Additive, non-blocking.
if (process.env.EVENT_CONSUMERS !== "0") {
  const { startConsumers } = await import("./consumers");
  startConsumers().catch((err) =>
    console.error("[consumers] startup failed:", err),
  );
}

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
