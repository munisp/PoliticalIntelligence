/**
 * Onboarding queries: pack discovery (YAML packs on disk), deterministic
 * local upsert fallback, and provenance summaries.
 *
 * The YAML loader is a deliberately small subset parser (no new dependency):
 * block maps by 2-space indent, `- item` lists, `{flow: maps}`, quoted and
 * plain scalars, `>` block scalars, `#` comments. It covers the pack format
 * in onboarding/packs/; the packs are also validated by zod (packSchema)
 * after parsing, so malformed files fail loudly.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import {
  packSchema,
  type JurisdictionProvenanceSummary,
  type OnboardingPack,
  type PackSummary,
  type PackUnit,
} from "@contracts/onboarding";
import { getDb } from "./connection";

/* ------------------------------------------------------------------ */
/* Minimal YAML subset parser                                          */
/* ------------------------------------------------------------------ */

type YamlLine = { indent: number; text: string };

function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") depth--;
      else if (c === "#" && depth === 0 && (i === 0 || line[i - 1] === " "))
        return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

function parseScalar(raw: string): unknown {
  const s = raw.trim();
  if (s === "" ) return null;
  if (s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (s.startsWith("{") && s.endsWith("}")) return parseFlowMap(s);
  if (s.startsWith("[") && s.endsWith("]")) return parseFlowList(s);
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  )
    return s.slice(1, -1);
  if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return Number.parseFloat(s);
  return s;
}

function splitFlow(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  for (const c of inner) {
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    if (!inSingle && !inDouble) {
      if (c === "{" || c === "[") depth++;
      if (c === "}" || c === "]") depth--;
      if (c === "," && depth === 0) {
        parts.push(cur);
        cur = "";
        continue;
      }
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function parseFlowMap(s: string): Record<string, unknown> {
  const inner = s.slice(1, -1).trim();
  const out: Record<string, unknown> = {};
  if (!inner) return out;
  for (const part of splitFlow(inner)) {
    const idx = part.indexOf(":");
    out[part.slice(0, idx).trim()] = parseScalar(part.slice(idx + 1));
  }
  return out;
}

function parseFlowList(s: string): unknown[] {
  const inner = s.slice(1, -1).trim();
  if (!inner) return [];
  return splitFlow(inner).map(parseScalar);
}

/** Parse the YAML subset used by onboarding packs. */
export function parsePackYaml(text: string): unknown {
  const rawLines = text.split(/\r?\n/);
  // Pre-process block scalars ("key: >") into joined plain values.
  const lines: YamlLine[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    let content = stripComment(raw.trim());
    if (!content) continue;
    if (content.endsWith(": >") || content.endsWith(": >-")) {
      const key = content.slice(0, content.indexOf(":"));
      const buf: string[] = [];
      while (i + 1 < rawLines.length) {
        const nxt = rawLines[i + 1];
        const nIndent = nxt.length - nxt.trimStart().length;
        if (nxt.trim() && nIndent <= indent) break;
        if (nxt.trim()) buf.push(nxt.trim());
        i++;
      }
      content = `${key}: "${buf.join(" ").replace(/"/g, "'")}"`;
    }
    lines.push({ indent, text: content });
  }

  function parseBlock(pos: number, indent: number): [unknown, number] {
    const isList = lines[pos]?.text.startsWith("- ") || lines[pos]?.text === "-";
    const container: unknown = isList ? [] : {};
    let i = pos;
    while (i < lines.length && lines[i].indent >= indent) {
      const line = lines[i];
      if (line.indent > indent) throw new Error(`bad indent at: ${line.text}`);
      if (isList) {
        const arr = container as unknown[];
        const rest = line.text.replace(/^-\s*/, "");
        if (rest.includes(":") && !rest.startsWith("{") && !rest.startsWith('"')) {
          // inline first key of a map item, e.g. "- id: ng-kd-01"
          const idx = rest.indexOf(":");
          const obj: Record<string, unknown> = {
            [rest.slice(0, idx).trim()]: parseScalar(rest.slice(idx + 1)),
          };
          i++;
          while (i < lines.length && lines[i].indent > indent) {
            const sub = lines[i];
            const sIdx = sub.text.indexOf(":");
            const sKey = sub.text.slice(0, sIdx).trim();
            const sVal = sub.text.slice(sIdx + 1).trim();
            if (sVal === "") {
              const [child, next] = parseBlock(i + 1, lines[i + 1].indent);
              obj[sKey] = child;
              i = next;
            } else {
              obj[sKey] = parseScalar(sVal);
              i++;
            }
          }
          arr.push(obj);
        } else {
          arr.push(parseScalar(rest));
          i++;
        }
      } else {
        const obj = container as Record<string, unknown>;
        const idx = line.text.indexOf(":");
        const key = line.text.slice(0, idx).trim();
        const val = line.text.slice(idx + 1).trim();
        if (val === "") {
          if (i + 1 < lines.length && lines[i + 1].indent > indent) {
            const [child, next] = parseBlock(i + 1, lines[i + 1].indent);
            obj[key] = child;
            i = next;
          } else {
            obj[key] = null;
            i++;
          }
        } else {
          obj[key] = parseScalar(val);
          i++;
        }
      }
    }
    return [container, i];
  }

  if (lines.length === 0) return {};
  return parseBlock(0, lines[0].indent)[0];
}

/* ------------------------------------------------------------------ */
/* Pack discovery                                                      */
/* ------------------------------------------------------------------ */

const PACKS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../onboarding/packs",
);

export function listPackCodes(): string[] {
  if (!existsSync(PACKS_DIR)) return [];
  return readdirSync(PACKS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(PACKS_DIR, d.name, "pack.yaml")))
    .map((d) => d.name)
    .sort();
}

export function loadPack(packCode: string): OnboardingPack {
  if (!/^[a-z0-9-]+$/.test(packCode)) throw new Error(`invalid pack code ${packCode}`);
  const file = path.join(PACKS_DIR, packCode, "pack.yaml");
  if (!existsSync(file)) throw new Error(`pack not found: ${packCode}`);
  const parsed = parsePackYaml(readFileSync(file, "utf8"));
  const result = packSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`pack ${packCode} failed validation: ${result.error.message}`);
  }
  return result.data;
}

function countUnits(units: PackUnit[]): number {
  return units.reduce((n, u) => n + 1 + (u.children ? countUnits(u.children) : 0), 0);
}

export function packSummary(packCode: string, pack: OnboardingPack): PackSummary {
  return {
    pack_code: packCode,
    jurisdiction_id: pack.jurisdiction.id,
    name: pack.jurisdiction.name,
    country_iso3: pack.jurisdiction.country_iso3,
    currency: pack.jurisdiction.currency,
    languages: pack.jurisdiction.languages,
    admin_levels: pack.jurisdiction.admin_levels,
    unit_count: countUnits(pack.hierarchy.units),
    connectors: Object.keys(pack.connectors),
    ...(pack.branding?.display_name
      ? { display_name: pack.branding.display_name }
      : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic local fallback upsert                                 */
/* ------------------------------------------------------------------ */

const PACK_PROVENANCE = {
  origin: "seed" as const,
  sourceUrl: null as string | null,
  fetchedAt: null as Date | null,
};

export async function upsertPack(pack: OnboardingPack): Promise<Record<string, number>> {
  const db = getDb();
  const j = pack.jurisdiction;
  const counts: Record<string, number> = {
    jurisdictions: 0,
    admin_units: 0,
    sectors: 0,
  };

  // Pack-declared structure is config, not fetched data — labeled `seed`.
  await db
    .insert(schema.jurisdictions)
    .values({
      jurisdictionId: j.id,
      name: j.name,
      adminLevel: j.admin_level,
      countryCode: j.country_code,
      parentId: j.parent_id ?? null,
      sourceRefs: [{ pack: j.id, country_iso3: j.country_iso3 }],
      ...PACK_PROVENANCE,
    })
    .onDuplicateKeyUpdate({
      set: { name: j.name, adminLevel: j.admin_level, countryCode: j.country_code },
    });
  counts.jurisdictions = 1;

  async function upsertUnits(units: PackUnit[], parentId: string | null) {
    for (const u of units) {
      await db
        .insert(schema.adminUnits)
        .values({
          adminUnitId: u.id,
          jurisdictionId: j.id,
          name: u.name,
          adminLevel: pack.hierarchy.level,
          countryCode: j.country_code,
          parentId,
          population: u.population ?? null,
          ...PACK_PROVENANCE,
        })
        .onDuplicateKeyUpdate({
          set: { name: u.name, parentId, population: u.population ?? null },
        });
      counts.admin_units++;
      if (u.children) await upsertUnits(u.children, u.id);
    }
  }
  await upsertUnits(pack.hierarchy.units, null);

  for (const s of pack.sectors) {
    await db
      .insert(schema.sectors)
      .values({
        sectorCode: s.code,
        name: s.name,
        description: `multiplier_set=${s.multiplier_set}`,
      })
      .onDuplicateKeyUpdate({ set: { name: s.name } });
    counts.sectors++;
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* Ingestion run bookkeeping                                           */
/* ------------------------------------------------------------------ */

export async function recordIngestionRun(run: {
  runId: string;
  connector: string;
  jurisdictionId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  recordsIn?: number;
  recordsOut?: number;
  contractResults?: unknown;
  error?: string | null;
  startedAt?: Date;
  finishedAt?: Date;
}) {
  await getDb()
    .insert(schema.ingestionRuns)
    .values({
      runId: run.runId,
      connector: run.connector,
      jurisdictionId: run.jurisdictionId,
      status: run.status,
      recordsIn: run.recordsIn ?? 0,
      recordsOut: run.recordsOut ?? 0,
      contractResults: (run.contractResults as object) ?? null,
      error: run.error ?? null,
      startedAt: run.startedAt ?? null,
      finishedAt: run.finishedAt ?? null,
    })
    .onDuplicateKeyUpdate({
      set: {
        status: run.status,
        recordsIn: run.recordsIn ?? 0,
        recordsOut: run.recordsOut ?? 0,
        contractResults: (run.contractResults as object) ?? null,
        error: run.error ?? null,
        finishedAt: run.finishedAt ?? null,
      },
    });
}

/* ------------------------------------------------------------------ */
/* Provenance summaries                                                */
/* ------------------------------------------------------------------ */

async function originCounts(table: "sector_metrics" | "facilities" | "procurement_records", jurisdictionId: string) {
  const t = table === "sector_metrics"
    ? schema.sectorMetrics
    : table === "facilities"
      ? schema.facilities
      : schema.procurementRecords;
  const rows = await getDb()
    .select({ origin: t.origin, n: sql<number>`count(*)` })
    .from(t)
    .where(eq(t.jurisdictionId, jurisdictionId))
    .groupBy(t.origin);
  const out = { live: 0, derived: 0, seed: 0 };
  for (const r of rows) {
    if (r.origin === "live") out.live = Number(r.n);
    else if (r.origin === "derived") out.derived = Number(r.n);
    else out.seed = Number(r.n);
  }
  return out;
}

export async function jurisdictionProvenanceSummaries(): Promise<JurisdictionProvenanceSummary[]> {
  const db = getDb();
  const jurs = await db.select().from(schema.jurisdictions);
  const lastRuns = await db
    .select({
      jurisdictionId: schema.ingestionRuns.jurisdictionId,
      last: sql<string | null>`max(${schema.ingestionRuns.finishedAt})`,
    })
    .from(schema.ingestionRuns)
    .groupBy(schema.ingestionRuns.jurisdictionId);
  const lastByJur = new Map(lastRuns.map((r) => [r.jurisdictionId, r.last]));
  const out: JurisdictionProvenanceSummary[] = [];
  for (const j of jurs) {
    const [metrics, facil, proc] = await Promise.all([
      originCounts("sector_metrics", j.jurisdictionId),
      originCounts("facilities", j.jurisdictionId),
      originCounts("procurement_records", j.jurisdictionId),
    ]);
    const last = lastByJur.get(j.jurisdictionId) ?? null;
    out.push({
      jurisdiction_id: j.jurisdictionId,
      name: j.name,
      admin_level: j.adminLevel,
      origin: j.origin,
      counts: { metrics, facilities: facil, procurement: proc },
      last_ingestion_at: last ? new Date(last).toISOString() : null,
    });
  }
  return out;
}
