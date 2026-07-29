#!/usr/bin/env node
/**
 * Migration/schema parity check (audit gap #1 follow-up).
 *
 * Asserts that every `mysqlTable("name", ...)` declared in db/schema.ts has
 * a corresponding `CREATE TABLE [IF NOT EXISTS] `name`` somewhere in
 * db/migrations/*.sql. Exits non-zero and prints the drift list otherwise.
 *
 * Run: node scripts/check-migration-parity.mjs  (or npm run db:check:parity)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const schemaSrc = readFileSync(join(root, "db/schema.ts"), "utf8");

// mysqlTable("name", ...) — both inline and multi-line call forms.
const schemaTables = new Set();
const inline = /mysqlTable\(\s*"([a-z_0-9]+)"/g;
let m;
while ((m = inline.exec(schemaSrc))) schemaTables.add(m[1]);
// multi-line: mysqlTable(\n  "name",
const multiline = /mysqlTable\(\s*\n\s*"([a-z_0-9]+)"/g;
while ((m = multiline.exec(schemaSrc))) schemaTables.add(m[1]);

const migDir = join(root, "db/migrations");
const sql = readdirSync(migDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(migDir, f), "utf8"))
  .join("\n");

const migTables = new Set();
const create = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+`([a-z_0-9]+)`/gi;
while ((m = create.exec(sql))) migTables.add(m[1].toLowerCase());

const missing = [...schemaTables].filter((t) => !migTables.has(t)).sort();
const extra = [...migTables].filter((t) => !schemaTables.has(t)).sort();

console.log(
  `parity: ${schemaTables.size} tables in schema.ts, ${migTables.size} CREATE TABLEs in migrations`,
);
if (extra.length) {
  console.warn(`warn: migrations create tables not in schema.ts: ${extra.join(", ")}`);
}
if (missing.length) {
  console.error(
    `FAIL: ${missing.length} schema table(s) missing from migrations: ${missing.join(", ")}`,
  );
  process.exit(1);
}
console.log("parity: OK — every schema.ts table has a CREATE TABLE in migrations");
