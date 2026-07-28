import { createHash } from "node:crypto";
import { asc, desc } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { env } from "../lib/env";

/**
 * Hash-chained tamper-evident audit log.
 *
 * Every appended event stores:
 *   prev_hash  — entry_hash of the previous event ("GENESIS" for the first)
 *   entry_hash — sha256(canonical(event fields) + prev_hash)
 *
 * Appends are serialized in-process (promise chain) so prev_hash is always
 * the true predecessor even under concurrent fire-and-forget writers.
 * `verifyAuditChain` replays the whole chain and reports the first broken id.
 */

export const GENESIS_HASH = "GENESIS";

type ChainableEvent = {
  actorId: number | null;
  action: string;
  entityType: string;
  entityId: string;
  scopes: unknown;
  requestId: string | null;
  correlationId: string | null;
  payload: unknown;
};

/** Deterministic canonical serialization (sorted keys, no whitespace). */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

export function computeEntryHash(event: ChainableEvent, prevHash: string): string {
  const canonical = canonicalize({
    actor_id: event.actorId,
    action: event.action,
    entity_type: event.entityType,
    entity_id: event.entityId,
    scopes: event.scopes ?? null,
    request_id: event.requestId,
    correlation_id: event.correlationId,
    payload: event.payload ?? null,
  });
  return createHash("sha256").update(`${canonical}|${prevHash}`).digest("hex");
}

let appendQueue: Promise<unknown> = Promise.resolve();

/**
 * Cross-process append serialization.
 *
 * The in-process promise chain above is not enough when several node
 * processes (API server, workers, parallel test runners) share one database:
 * two processes can read the same tail hash and fork the chain. MySQL/TiDB
 * named locks (GET_LOCK) give us a cluster-wide mutex around the
 * read-tail + insert critical section. When the server does not support
 * named locks we degrade to in-process serialization (documented).
 */
const LOCK_NAME = "policy_twin_audit_chain";
let lockConn: import("mysql2/promise").Connection | null | undefined;

async function withChainLock<T>(fn: () => Promise<T>): Promise<T> {
  if (lockConn === undefined) {
    try {
      const mysql = await import("mysql2/promise");
      lockConn = await mysql.createConnection(env.databaseUrl);
    } catch {
      lockConn = null; // no driver / unreachable: in-process only
    }
  }
  if (!lockConn) return fn();
  try {
    await lockConn.query(`SELECT GET_LOCK('${LOCK_NAME}', 30)`);
  } catch {
    return fn(); // named locks unsupported: degrade gracefully
  }
  try {
    return await fn();
  } finally {
    await lockConn.query(`SELECT RELEASE_LOCK('${LOCK_NAME}')`).catch(() => {});
  }
}

async function lastHash(): Promise<string> {
  const rows = await getDb()
    .select({ entryHash: schema.auditEvents.entryHash })
    .from(schema.auditEvents)
    .orderBy(desc(schema.auditEvents.eventId))
    .limit(1);
  return rows[0]?.entryHash ?? GENESIS_HASH;
}

/**
 * Serialized chained insert. Returns the inserted hashes. Never called
 * concurrently: callers go through insertAuditEvent (queries/audit.ts).
 */
export function appendChained<T extends ChainableEvent>(
  event: T,
): Promise<{ prevHash: string; entryHash: string }> {
  const task = appendQueue.then(() => withChainLock(async () => {
    const prevHash = await lastHash();
    const entryHash = computeEntryHash(event, prevHash);
    await getDb()
      .insert(schema.auditEvents)
      .values({ ...event, prevHash, entryHash } as never);
    return { prevHash, entryHash };
  }));
  appendQueue = task.catch(() => undefined);
  return task;
}

export interface ChainVerification {
  chain_valid: boolean;
  events_checked: number;
  first_broken_id: number | null;
  /** Legacy events written before chaining was enabled are skipped. */
  legacy_events: number;
}

/** Replay the full chain; detect any tampering (edit/delete/reorder). */
export async function verifyAuditChain(): Promise<ChainVerification> {
  const rows = await getDb()
    .select()
    .from(schema.auditEvents)
    .orderBy(asc(schema.auditEvents.eventId));
  let prev = GENESIS_HASH;
  let checked = 0;
  let legacy = 0;
  for (const row of rows) {
    if (!row.entryHash || !row.prevHash) {
      legacy += 1;
      // Legacy rows don't advance the chain; the next chained row's
      // prev_hash is validated against the last *chained* row.
      continue;
    }
    checked += 1;
    if (row.prevHash !== prev) {
      return { chain_valid: false, events_checked: checked, first_broken_id: Number(row.eventId), legacy_events: legacy };
    }
    const recomputed = computeEntryHash(
      {
        actorId: row.actorId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        scopes: row.scopes,
        requestId: row.requestId,
        correlationId: row.correlationId,
        payload: row.payload,
      },
      row.prevHash,
    );
    if (recomputed !== row.entryHash) {
      return { chain_valid: false, events_checked: checked, first_broken_id: Number(row.eventId), legacy_events: legacy };
    }
    prev = row.entryHash;
  }
  return { chain_valid: true, events_checked: checked, first_broken_id: null, legacy_events: legacy };
}
