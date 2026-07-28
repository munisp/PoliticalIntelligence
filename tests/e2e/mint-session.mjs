#!/usr/bin/env node
/**
 * Mint a `kimi_sid` session cookie value for e2e/k6 runs against a dev or CI
 * instance. Zero dependencies (HS256 via node:crypto), compatible with
 * api/kimi/session.ts (HS256, APP_SECRET, {unionId, clientId} claims).
 *
 * Usage:
 *   node tests/e2e/mint-session.mjs --union-id e2e-analyst
 *   SESSION_COOKIE=$(node tests/e2e/mint-session.mjs --union-id e2e-executive)
 *
 * Secret resolution: APP_SECRET env var, else .env in the repo root.
 * The referenced user must exist in the DB (see tests/e2e/seed-users.ts).
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function appSecret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  try {
    for (const line of readFileSync(resolve(root, ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*APP_SECRET\s*=\s*(.+)\s*$/);
      if (m) return m[1];
    }
  } catch {
    /* no .env */
  }
  throw new Error("APP_SECRET not found in env or .env");
}

const unionId = arg("union-id", "e2e-analyst");
const clientId = arg("client-id", "e2e");

const b64u = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const now = Math.floor(Date.now() / 1000);
const payload = b64u(
  JSON.stringify({ unionId, clientId, iat: now, exp: now + 365 * 24 * 3600 }),
);
const sig = createHmac("sha256", Buffer.from(appSecret(), "utf8"))
  .update(`${header}.${payload}`)
  .digest();
process.stdout.write(`${header}.${payload}.${b64u(sig)}`);
