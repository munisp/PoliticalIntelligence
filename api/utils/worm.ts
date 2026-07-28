import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { asc, desc, gt } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { computeEntryHash, GENESIS_HASH } from "./auditchain";

/**
 * WORM audit export (SEC-4, DM-7 — docs/SECURITY.md).
 *
 * Hourly (startWormExporter interval, wired from api/consumers.ts) and
 * on-demand (`exportWormNow` — the `auditLog.exportWorm` procedure surface)
 * this writes an append-only, hash-anchored export of new audit_events rows:
 *
 *   artifacts/audit-worm/audit-worm-<from>-<to>.jsonl      (one event/line)
 *   artifacts/audit-worm/audit-worm-<from>-<to>.manifest.json
 *       { sha256 (of the JSONL), chain_head, from, to, event_count }
 *
 * The running chain head is also checkpointed in `audit_worm_exports`, so
 * continuity is verifiable across restarts even if the artifact directory is
 * remounted. Export files are written once and never rewritten (WORM).
 *
 * S3 Object Lock adapter (optional, env-gated):
 *   WORM_S3_BUCKET            target bucket with Object Lock enabled
 *   WORM_S3_PREFIX            key prefix (default "audit-worm/")
 *   WORM_RETENTION_YEARS      Object Lock retention (default 7)
 *   AWS_REGION / AWS credentials per the standard SDK chain
 * Uses @aws-sdk/client-s3 lazily; objects are PUT with
 * ObjectLockMode=COMPLIANCE. For presigned-URL flows (boto-style), set
 * WORM_S3_PRESIGN_URL_TEMPLATE ("{key}" placeholder) and the file is PUT via
 * plain fetch instead — documented in docs/SECURITY.md.
 */

const EXPORT_DIR = () => process.env.WORM_EXPORT_DIR ?? "./artifacts/audit-worm";
const BATCH_LIMIT = 10_000;

export interface WormExportResult {
  exported: number;
  file?: string;
  manifest?: string;
  chainHead?: string;
  manifestSha256?: string;
  s3?: string;
}

interface WormManifest {
  file: string;
  from_event_id: number;
  to_event_id: number;
  event_count: number;
  chain_head: string;
  sha256: string;
  exported_at: string;
}

type AuditRow = typeof schema.auditEvents.$inferSelect;

function lineFor(row: AuditRow): string {
  return JSON.stringify({
    event_id: Number(row.eventId),
    actor_id: row.actorId,
    action: row.action,
    entity_type: row.entityType,
    entity_id: row.entityId,
    scopes: row.scopes ?? null,
    request_id: row.requestId,
    correlation_id: row.correlationId,
    payload: row.payload ?? null,
    prev_hash: row.prevHash,
    entry_hash: row.entryHash,
    created_at: row.createdAt.toISOString(),
  });
}

async function lastWatermark(): Promise<number> {
  const rows = await getDb()
    .select({ toEventId: schema.auditWormExports.toEventId })
    .from(schema.auditWormExports)
    .orderBy(desc(schema.auditWormExports.toEventId))
    .limit(1);
  return rows[0]?.toEventId ?? 0;
}

async function lastChainHead(): Promise<string> {
  const rows = await getDb()
    .select({ chainHead: schema.auditWormExports.chainHead })
    .from(schema.auditWormExports)
    .orderBy(desc(schema.auditWormExports.toEventId))
    .limit(1);
  return rows[0]?.chainHead ?? GENESIS_HASH;
}

async function uploadToS3(key: string, body: string): Promise<string | null> {
  const presignTemplate = process.env.WORM_S3_PRESIGN_URL_TEMPLATE;
  if (presignTemplate) {
    const years = Number(process.env.WORM_RETENTION_YEARS ?? 7);
    const retainUntil = new Date(Date.now() + years * 365 * 24 * 3600 * 1000);
    const url = presignTemplate.replace("{key}", encodeURIComponent(key));
    // COMPLIANCE-mode Object Lock headers — the presigning side must have
    // signed these headers (docs/SECURITY.md §Evidence immutability).
    const resp = await fetch(url, {
      method: "PUT",
      body,
      headers: {
        "x-amz-object-lock-mode": "COMPLIANCE",
        "x-amz-object-lock-retain-until-date": retainUntil.toISOString(),
      },
    });
    if (!resp.ok) throw new Error(`presigned PUT failed: HTTP ${resp.status}`);
    return `presigned:${key}`;
  }
  const bucket = process.env.WORM_S3_BUCKET;
  if (!bucket) return null;
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const years = Number(process.env.WORM_RETENTION_YEARS ?? 7);
  const retainUntil = new Date(Date.now() + years * 365 * 24 * 3600 * 1000);
  const client = new S3Client({});
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ObjectLockMode: "COMPLIANCE",
      ObjectLockRetainUntilDate: retainUntil,
      ChecksumAlgorithm: "SHA256",
    }),
  );
  return `s3://${bucket}/${key}`;
}

/** On-demand WORM export of all audit events since the last checkpoint. */
export async function exportWormNow(): Promise<WormExportResult> {
  const watermark = await lastWatermark();
  const rows = await getDb()
    .select()
    .from(schema.auditEvents)
    .where(gt(schema.auditEvents.eventId, watermark))
    .orderBy(asc(schema.auditEvents.eventId))
    .limit(BATCH_LIMIT);
  if (rows.length === 0) return { exported: 0 };

  const expectedPrev = await lastChainHead();
  // First-ever export anchors at the first event's own prev_hash (the live
  // DB chain may predate WORM checkpoints); later exports must chain on.
  if (expectedPrev !== GENESIS_HASH && rows[0].prevHash &&
      rows[0].prevHash !== expectedPrev) {
    throw new Error(
      `[worm] chain gap before export: first new event ${rows[0].eventId} ` +
        `prev_hash ${rows[0].prevHash} != checkpoint head ${expectedPrev}`,
    );
  }

  const from = Number(rows[0].eventId);
  const to = Number(rows[rows.length - 1].eventId);
  // Chain head = last CHAINED event's hash (legacy rows don't advance it).
  const chainHead =
    [...rows].reverse().find((r) => r.entryHash)?.entryHash ?? expectedPrev;
  const jsonl = rows.map(lineFor).join("\n") + "\n";
  const sha256 = createHash("sha256").update(jsonl).digest("hex");

  const dir = EXPORT_DIR();
  mkdirSync(dir, { recursive: true });
  const base = `audit-worm-${from}-${to}`;
  const file = path.join(dir, `${base}.jsonl`);
  if (existsSync(file)) {
    // WORM: never rewrite an existing export artifact.
    return { exported: 0, file, chainHead };
  }
  writeFileSync(file, jsonl, { flag: "wx" });
  const manifest: WormManifest = {
    file: `${base}.jsonl`,
    from_event_id: from,
    to_event_id: to,
    event_count: rows.length,
    chain_head: chainHead,
    sha256,
    exported_at: new Date().toISOString(),
  };
  const manifestBody = JSON.stringify(manifest, null, 2);
  const manifestPath = path.join(dir, `${base}.manifest.json`);
  writeFileSync(manifestPath, manifestBody, { flag: "wx" });

  await getDb()
    .insert(schema.auditWormExports)
    .values({
      exportId: `worm-${from}-${to}`,
      fileName: `${base}.jsonl`,
      fromEventId: from,
      toEventId: to,
      eventCount: rows.length,
      chainHead,
      manifestSha256: sha256,
    });

  let s3: string | undefined;
  try {
    const prefix = process.env.WORM_S3_PREFIX ?? "audit-worm/";
    const uploaded =
      (await uploadToS3(`${prefix}${base}.jsonl`, jsonl)) ??
      (await uploadToS3(`${prefix}${base}.manifest.json`, manifestBody));
    if (uploaded) s3 = uploaded;
  } catch (err) {
    console.error("[worm] S3 object-lock upload failed (local export kept):", err);
  }
  return {
    exported: rows.length,
    file,
    manifest: manifestPath,
    chainHead,
    manifestSha256: sha256,
    ...(s3 ? { s3 } : {}),
  };
}

/* ------------------------------ Verify ------------------------------ */

export interface WormVerification {
  valid: boolean;
  files_checked: number;
  events_checked: number;
  error?: string;
}

/**
 * Read back every export in the directory and validate:
 *  - manifest sha256 matches the JSONL bytes,
 *  - each event's entry_hash recomputes from its fields,
 *  - chain continuity WITHIN and ACROSS exports (no gaps: the first event of
 *    file N+1 must chain from the head of file N).
 */
export function verifyWormExports(dir = EXPORT_DIR()): WormVerification {
  if (!existsSync(dir)) return { valid: true, files_checked: 0, events_checked: 0 };
  const manifests = readdirSync(dir)
    .filter((f) => f.endsWith(".manifest.json"))
    .sort();
  let prevHead = GENESIS_HASH;
  let events = 0;
  for (const mf of manifests) {
    const manifest = JSON.parse(
      readFileSync(path.join(dir, mf), "utf8"),
    ) as WormManifest;
    const jsonlPath = path.join(dir, manifest.file);
    if (!existsSync(jsonlPath)) {
      return { valid: false, files_checked: 0, events_checked: events,
               error: `missing export file ${manifest.file}` };
    }
    const body = readFileSync(jsonlPath, "utf8");
    const sha = createHash("sha256").update(body).digest("hex");
    if (sha !== manifest.sha256) {
      return { valid: false, files_checked: 0, events_checked: events,
               error: `manifest sha mismatch for ${manifest.file}` };
    }
    const lines = body.trim().split("\n").filter(Boolean);
    if (lines.length !== manifest.event_count) {
      return { valid: false, files_checked: 0, events_checked: events,
               error: `event count mismatch in ${manifest.file}` };
    }
    let head = prevHead;
    let firstLine = true;
    for (const line of lines) {
      const ev = JSON.parse(line);
      if (firstLine && prevHead === GENESIS_HASH && ev.prev_hash) {
        // Anchor the very first export at its first chained event (the live
        // chain may predate WORM exports).
        head = ev.prev_hash;
      }
      firstLine = false;
      if (!ev.prev_hash || !ev.entry_hash) {
        // Legacy pre-chaining event: counted but does not advance the chain.
        events += 1;
        continue;
      }
      if (ev.prev_hash !== head) {
        return {
          valid: false, files_checked: 0, events_checked: events,
          error: `chain gap at event ${ev.event_id} in ${manifest.file}: ` +
                 `prev_hash ${ev.prev_hash} != expected ${head}`,
        };
      }
      const recomputed = computeEntryHash(
        {
          actorId: ev.actor_id,
          action: ev.action,
          entityType: ev.entity_type,
          entityId: ev.entity_id,
          scopes: ev.scopes,
          requestId: ev.request_id,
          correlationId: ev.correlation_id,
          payload: ev.payload,
        },
        ev.prev_hash,
      );
      if (recomputed !== ev.entry_hash) {
        return { valid: false, files_checked: 0, events_checked: events,
                 error: `hash mismatch at event ${ev.event_id}` };
      }
      head = ev.entry_hash;
      events += 1;
    }
    if (head !== manifest.chain_head) {
      return { valid: false, files_checked: 0, events_checked: events,
               error: `chain head mismatch in ${manifest.file}` };
    }
    prevHead = head;
  }
  return { valid: true, files_checked: manifests.length, events_checked: events };
}

/* ------------------------------ Interval ----------------------------- */

let wormTimer: ReturnType<typeof setInterval> | null = null;

/** Hourly WORM export interval (default 1h, WORM_EXPORT_INTERVAL_MS). */
export function startWormExporter(
  intervalMs = Number(process.env.WORM_EXPORT_INTERVAL_MS ?? 3_600_000),
): void {
  if (wormTimer) return;
  wormTimer = setInterval(() => {
    exportWormNow().catch((err) => console.error("[worm] export failed:", err));
  }, intervalMs);
  wormTimer.unref?.();
}

export function stopWormExporter(): void {
  if (wormTimer) clearInterval(wormTimer);
  wormTimer = null;
}
