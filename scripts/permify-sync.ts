/**
 * Permify relationship sync (feat-mw-edge-authz).
 *
 * Converges Permify's relationship store with the operational DB:
 *   1. writes the ReBAC schema (infra/permify/schema.perm) to the tenant;
 *   2. mirrors the admin_units hierarchy as
 *      `jurisdiction:<child>#parent@jurisdiction:<parent>` tuples;
 *   3. mirrors dataset_policies as `dataset:<id>#jur@jurisdiction:<id>`
 *      tuples plus the classification attribute, so Permify `read` checks
 *      resolve identically to the ABAC path.
 *
 * Idempotent: Permify data/write upserts tuples; re-running is safe.
 *
 * Usage:
 *   PERMIFY_URL=http://localhost:3476 npx tsx scripts/permify-sync.ts
 *
 * Env: PERMIFY_URL (required), PERMIFY_TENANT_ID (default t1),
 *      DATABASE_URL (operational store, as usual).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { isNotNull } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../api/queries/connection";

const BASE = (process.env.PERMIFY_URL ?? "").replace(/\/$/, "");
const TENANT = process.env.PERMIFY_TENANT_ID || "t1";

if (!BASE) {
  console.error("PERMIFY_URL is required (e.g. http://localhost:3476)");
  process.exit(1);
}

async function post(route: string, body: unknown): Promise<unknown> {
  const resp = await fetch(
    `${BASE}/v1/tenants/${encodeURIComponent(TENANT)}${route}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!resp.ok) {
    throw new Error(`${route} → HTTP ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
}

async function writeSchema(): Promise<string> {
  const perm = readFileSync(
    path.resolve(__dirname, "../infra/permify/schema.perm"),
    "utf8",
  );
  const res = (await post("/schemas/write", {
    schema: perm,
  })) as { schema_version?: string };
  console.log(`schema written, version ${res.schema_version ?? "(unknown)"}`);
  return res.schema_version ?? "";
}

type Tuple = {
  entity: { type: string; id: string };
  relation: string;
  subject: { type: string; id: string; relation?: string };
};

async function writeTuples(tuples: Tuple[]): Promise<void> {
  const CHUNK = 100;
  for (let i = 0; i < tuples.length; i += CHUNK) {
    await post("/data/write", {
      metadata: { schema_version: "" },
      tuples: tuples.slice(i, i + CHUNK),
      attributes: [],
    });
  }
  console.log(`${tuples.length} relationship tuples written`);
}

async function main() {
  await writeSchema();
  const db = getDb();

  // 1) Jurisdiction hierarchy from admin_units (parent edges only).
  const units = await db
    .select({
      id: schema.adminUnits.adminUnitId,
      parentId: schema.adminUnits.parentId,
    })
    .from(schema.adminUnits)
    .where(isNotNull(schema.adminUnits.parentId));
  const jurTuples: Tuple[] = units.map((u) => ({
    entity: { type: "jurisdiction", id: u.id },
    relation: "parent",
    subject: { type: "jurisdiction", id: u.parentId as string },
  }));

  // 2) Dataset → jurisdiction links from dataset_policies.
  const policies = await db
    .select({
      datasetId: schema.datasetPolicies.datasetId,
      jurisdictionId: schema.datasetPolicies.jurisdictionId,
    })
    .from(schema.datasetPolicies)
    .where(isNotNull(schema.datasetPolicies.jurisdictionId));
  const dsTuples: Tuple[] = policies.map((p) => ({
    entity: { type: "dataset", id: p.datasetId },
    relation: "jur",
    subject: { type: "jurisdiction", id: p.jurisdictionId as string },
  }));

  await writeTuples([...jurTuples, ...dsTuples]);
  console.log(
    `permify-sync done: ${jurTuples.length} jurisdiction edges, ` +
      `${dsTuples.length} dataset links (tenant ${TENANT})`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("permify-sync failed:", err);
  process.exit(1);
});
