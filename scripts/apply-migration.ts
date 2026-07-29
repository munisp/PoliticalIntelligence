/**
 * Apply one drizzle migration SQL file directly and journal it.
 *
 * `drizzle-kit migrate` hangs against the privatelink TiDB endpoint in this
 * environment, so migrations are applied statement-by-statement here and
 * journaled (sha256 of the file) exactly as drizzle-kit would — keeping
 * `npm run db:migrate` a no-op afterwards.
 *
 * Usage: npx tsx scripts/apply-migration.ts db/migrations/0003_x.sql
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: apply-migration.ts <file.sql>");
  const raw = readFileSync(file, "utf8");
  const stmts = raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  const db = getDb();
  await db.execute(
    sql.raw(
      "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
    ),
  );
  const hash = createHash("sha256").update(raw).digest("hex");
  const existing = (await db.execute(
    sql.raw(`SELECT hash FROM __drizzle_migrations WHERE hash = '${hash}'`),
  ))[0] as unknown[];
  if (existing.length > 0) {
    console.log(`already journaled: ${file}`);
    process.exit(0);
  }
  for (const s of stmts) {
    await db.execute(sql.raw(s));
    console.log(`applied: ${s.split("\n")[0].slice(0, 72)}`);
  }
  await db.execute(
    sql.raw(
      `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('${hash}', ${Date.now()})`,
    ),
  );
  console.log(`journaled: ${file}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
