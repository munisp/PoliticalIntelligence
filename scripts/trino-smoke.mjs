#!/usr/bin/env node
/**
 * Trino smoke check (audit gap #22 — docs/LAKEHOUSE.md, DM-5).
 *
 * Runs `SHOW CATALOGS` against a reachable Trino coordinator via its HTTP
 * API and verifies the expected `iceberg` catalog is present. Skips cleanly
 * (exit 0) when TRINO_URL is not set, so it is safe to wire into CI.
 *
 * Usage:
 *   docker compose -f infra/docker/docker-compose.yml --profile lakehouse up trino
 *   TRINO_URL=http://localhost:8080 node scripts/trino-smoke.mjs
 */
const TRINO_URL = process.env.TRINO_URL;

if (!TRINO_URL) {
  console.log("[trino-smoke] TRINO_URL not set — skipping (ok).");
  process.exit(0);
}

async function query(sql) {
  const res = await fetch(`${TRINO_URL.replace(/\/$/, "")}/v1/statement`, {
    method: "POST",
    headers: { "X-Trino-User": process.env.TRINO_USER || "smoke" },
    body: sql,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  let page = await res.json();
  const data = [];
  while (page) {
    if (page.data) data.push(...page.data);
    if (page.error) throw new Error(page.error.message);
    if (!page.nextUri) break;
    const next = await fetch(page.nextUri, {
      headers: { "X-Trino-User": process.env.TRINO_USER || "smoke" },
    });
    page = await next.json();
  }
  return data;
}

try {
  const rows = await query("SHOW CATALOGS");
  const catalogs = rows.map((r) => r[0]);
  console.log(`[trino-smoke] SHOW CATALOGS -> ${catalogs.join(", ")}`);
  if (!catalogs.includes("iceberg")) {
    console.error("[trino-smoke] FAIL: expected 'iceberg' catalog (infra/docker/trino/catalog/iceberg.properties)");
    process.exit(1);
  }
  console.log("[trino-smoke] OK");
} catch (err) {
  console.error(`[trino-smoke] FAIL: ${err.message}`);
  process.exit(1);
}
