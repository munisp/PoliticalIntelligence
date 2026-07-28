#!/usr/bin/env node
/**
 * tidb-dump.mjs — zero-binary logical dump/load fallback for environments
 * without the MySQL client toolchain (TiDB Cloud sandboxes, slim containers).
 *
 * scripts/backup.sh and scripts/restore.sh prefer mysqldump/mysql and fall
 * back to this tool when those binaries are absent. Output is plain SQL
 * compatible with `mysql < dump.sql` (and with this tool's own loader).
 *
 * Subcommands:
 *   dump <db> [--no-create-info] [--tables t1,t2,...]   write SQL to stdout
 *   load <db> <file.sql.gz|file.sql>                    load a dump, prints
 *                                                       "statements: N"
 *   exec <db> "<sql>"                                   run one statement,
 *                                                       rows as TSV to stdout
 *
 * Connection coordinates come from DATABASE_URL (mysql://user:pass@host:port/).
 * Uses the project's mysql2 dependency only.
 */
import { createRequire } from "node:module";
import { createGunzip } from "node:zlib";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");

const [, , cmd, dbName, ...rest] = process.argv;

function die(msg) {
  console.error(`[tidb-dump] ERROR: ${msg}`);
  process.exit(1);
}

function connectionConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) die("DATABASE_URL is required");
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    multipleStatements: true,
    // TiDB/MySQL compatible; TLS when the URL asks for it (ssl=true).
    ...(u.searchParams.get("ssl") === "true" ? { ssl: {} } : {}),
  };
}

function escapeValue(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (v instanceof Date) {
    return `'${v.toISOString().slice(0, 19).replace("T", " ")}'`;
  }
  if (Buffer.isBuffer(v)) return `0x${v.toString("hex")}`;
  // mysql2 parses JSON columns into objects — re-serialize them.
  if (typeof v === "object") v = JSON.stringify(v);
  const s = String(v).replace(/[\0\b\t\n\r\x1a"\\']/g, (c) => {
    switch (c) {
      case "\0": return "\\0";
      case "\b": return "\\b";
      case "\t": return "\\t";
      case "\n": return "\\n";
      case "\r": return "\\r";
      case "\x1a": return "\\Z";
      case '"': return '\\"';
      case "'": return "\\'";
      default: return "\\\\";
    }
  });
  return `'${s}'`;
}

async function dump(conn, db, { noCreateInfo, tables }) {
  const [allTables] = await conn.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
    [db],
  );
  let names = allTables.map((r) => r.TABLE_NAME);
  if (tables?.length) names = names.filter((n) => tables.includes(n));

  const out = process.stdout;
  out.write(`-- tidb-dump.mjs logical dump of \`${db}\` (${new Date().toISOString()})\n`);
  out.write("SET FOREIGN_KEY_CHECKS=0;\nSET NAMES utf8mb4;\n\n");
  let tablesDumped = 0;
  for (const name of names) {
    out.write(`--\n-- Table: \`${name}\`\n--\n`);
    if (!noCreateInfo) {
      const [ddlRows] = await conn.query(`SHOW CREATE TABLE \`${db}\`.\`${name}\``);
      const ddl = ddlRows[0]["Create Table"];
      out.write(`DROP TABLE IF EXISTS \`${name}\`;\n${ddl};\n\n`);
    }
    const [rows] = await conn.query(`SELECT * FROM \`${db}\`.\`${name}\``);
    if (rows.length) {
      const cols = Object.keys(rows[0]).map((c) => `\`${c}\``).join(", ");
      const BATCH = 100;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const values = batch
          .map((r) => `(${Object.values(r).map(escapeValue).join(",")})`)
          .join(",\n");
        out.write(`INSERT INTO \`${name}\` (${cols}) VALUES\n${values};\n`);
      }
    }
    out.write("\n");
    tablesDumped += 1;
  }
  out.write("SET FOREIGN_KEY_CHECKS=1;\n");
  console.error(`[tidb-dump] dumped ${tablesDumped} tables from ${db}`);
}

/** Split a SQL stream into statements, respecting quoted strings/comments. */
function splitStatements(sql) {
  const stmts = [];
  let cur = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      cur += c;
      i += 1;
      while (i < n) {
        cur += sql[i];
        if (sql[i] === "\\" && quote !== "`") { cur += sql[i + 1] ?? ""; i += 2; continue; }
        if (sql[i] === quote) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    if (c === "-" && sql[i + 1] === "-" && /\s/.test(sql[i + 2] ?? " ")) {
      while (i < n && sql[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === ";") {
      if (cur.trim()) stmts.push(cur);
      cur = "";
      i += 1;
      continue;
    }
    cur += c;
    i += 1;
  }
  if (cur.trim()) stmts.push(cur);
  return stmts;
}

async function readInput(file) {
  const chunks = [];
  const stream = file.endsWith(".gz")
    ? createReadStream(file).pipe(createGunzip())
    : createReadStream(file);
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function load(conn, db, file) {
  const sql = await readInput(file);
  const statements = splitStatements(sql);
  let executed = 0;
  for (const stmt of statements) {
    await conn.query(stmt);
    executed += 1;
  }
  console.log(`statements: ${executed}`);
  console.error(`[tidb-dump] loaded ${executed} statements into ${db}`);
}

async function execSql(conn, db, sql) {
  const [rows] = await conn.query(sql);
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (typeof row === "object" && row !== null) {
        console.log(Object.values(row).map((v) => (v === null ? "NULL" : String(v))).join("\t"));
      }
    }
  }
}

const main = async () => {
  if (!cmd || !dbName) {
    die("usage: tidb-dump.mjs dump|load|exec <db> [args]");
  }
  const conn = await mysql.createConnection({
    ...connectionConfig(),
    ...(cmd === "dump" ? {} : { database: dbName }),
  });
  try {
    if (cmd === "dump") {
      const noCreateInfo = rest.includes("--no-create-info");
      const tIdx = rest.indexOf("--tables");
      const tables = tIdx >= 0 ? rest[tIdx + 1].split(",").map((s) => s.trim()) : null;
      await dump(conn, dbName, { noCreateInfo, tables });
    } else if (cmd === "load") {
      await load(conn, dbName, rest[0]);
    } else if (cmd === "exec") {
      await execSql(conn, dbName, rest[0]);
    } else {
      die(`unknown subcommand: ${cmd}`);
    }
  } finally {
    await conn.end();
  }
};

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
