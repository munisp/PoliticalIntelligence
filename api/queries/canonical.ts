/**
 * Canonical record loader queries (feat-data-loader — docs/LOADER.md).
 *
 * Natural-key upserts for records produced by the ingestion service:
 *   sector_metric       (jurisdiction_id, metric_key, period, source_id)
 *   facility            facility_id (fallback: source)
 *   procurement_record  ocid (fallback: record_id)
 *   data_source         source_id (primary key)
 *
 * TiDB does not report MySQL `affectedRows` update semantics reliably
 * through `onDuplicateKeyUpdate`, so upserts are select-then-write:
 *   - existing natural key -> UPDATE value/confidence only; the original
 *     provenance (origin, source_url, fetched_at) is PRESERVED so a live
 *     row is never silently downgraded and replays are idempotent
 *     (second run = updates, not duplicates).
 *   - new natural key      -> INSERT with the record's provenance.
 *
 * Errors are collected per record (never raised) so one bad row cannot
 * abort a 500-record batch.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

export type Provenance = {
  origin: "live" | "derived" | "seed";
  source_id?: string | null;
  url?: string | null;
  fetched_at?: string | Date | null;
};

export type EntityCounts = {
  inserted: number;
  updated: number;
  errors: string[];
};

const empty = (): EntityCounts => ({ inserted: 0, updated: 0, errors: [] });

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ------------------------------------------------------------------ */
/* sector_metrics                                                       */
/* ------------------------------------------------------------------ */

export async function upsertSectorMetrics(
  rows: { data: Record<string, unknown>; provenance: Provenance }[],
): Promise<EntityCounts> {
  const db = getDb();
  const counts = empty();
  for (const { data, provenance } of rows) {
    try {
      const jurisdictionId = String(data.jurisdiction_id);
      const metricKey = String(data.metric_key);
      const period = String(data.period);
      const sourceId = provenance.source_id ?? null;
      const value = Number(data.value);
      const confidence =
        data.confidence !== undefined ? Number(data.confidence) : 0.5;
      const existing = await db
        .select({ id: schema.sectorMetrics.id })
        .from(schema.sectorMetrics)
        .where(
          and(
            eq(schema.sectorMetrics.jurisdictionId, jurisdictionId),
            eq(schema.sectorMetrics.metricKey, metricKey),
            eq(schema.sectorMetrics.period, period),
            sourceId
              ? eq(schema.sectorMetrics.sourceId, sourceId)
              : undefined,
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        // Update value only — preserve original provenance.
        await db
          .update(schema.sectorMetrics)
          .set({ value, confidence })
          .where(eq(schema.sectorMetrics.id, existing[0].id));
        counts.updated++;
      } else {
        await db.insert(schema.sectorMetrics).values({
          jurisdictionId,
          sectorCode: String(data.sector_code ?? "general"),
          metricKey,
          value,
          period,
          confidence,
          sourceId,
          origin: provenance.origin,
          sourceUrl: provenance.url ?? null,
          fetchedAt: toDate(provenance.fetched_at),
        });
        counts.inserted++;
      }
    } catch (err) {
      counts.errors.push(
        `sector_metric ${data.metric_key}/${data.period}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* facilities                                                           */
/* ------------------------------------------------------------------ */

export async function upsertFacilities(
  rows: { data: Record<string, unknown>; provenance: Provenance }[],
): Promise<EntityCounts> {
  const db = getDb();
  const counts = empty();
  for (const { data, provenance } of rows) {
    try {
      const facilityId = String(
        data.facility_id ??
          `${provenance.source_id ?? "src"}:${data.source ?? data.name}`,
      );
      const source = (data.source as string) ?? null;
      let existing = await db
        .select({ facilityId: schema.facilities.facilityId })
        .from(schema.facilities)
        .where(eq(schema.facilities.facilityId, facilityId))
        .limit(1);
      if (existing.length === 0 && source) {
        existing = await db
          .select({ facilityId: schema.facilities.facilityId })
          .from(schema.facilities)
          .where(eq(schema.facilities.source, source))
          .limit(1);
      }
      if (existing.length > 0) {
        await db
          .update(schema.facilities)
          .set({
            name: String(data.name ?? ""),
            lat: data.lat !== undefined ? Number(data.lat) : null,
            lon: data.lon !== undefined ? Number(data.lon) : null,
          })
          .where(eq(schema.facilities.facilityId, existing[0].facilityId));
        counts.updated++;
      } else {
        await db.insert(schema.facilities).values({
          facilityId,
          jurisdictionId: String(data.jurisdiction_id),
          type: String(data.type ?? "unknown"),
          name: String(data.name ?? facilityId),
          lat: data.lat !== undefined ? Number(data.lat) : null,
          lon: data.lon !== undefined ? Number(data.lon) : null,
          source,
          origin: provenance.origin,
          sourceUrl: provenance.url ?? null,
          fetchedAt: toDate(provenance.fetched_at),
        });
        counts.inserted++;
      }
    } catch (err) {
      counts.errors.push(
        `facility ${data.facility_id ?? data.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* procurement_records                                                  */
/* ------------------------------------------------------------------ */

export async function upsertProcurementRecords(
  rows: { data: Record<string, unknown>; provenance: Provenance }[],
): Promise<EntityCounts> {
  const db = getDb();
  const counts = empty();
  for (const { data, provenance } of rows) {
    try {
      const ocid = (data.ocid as string) ?? null;
      const recordId = String(data.record_id ?? `proc:${ocid}`);
      let existing = ocid
        ? await db
            .select({ recordId: schema.procurementRecords.recordId })
            .from(schema.procurementRecords)
            .where(eq(schema.procurementRecords.ocid, ocid))
            .limit(1)
        : [];
      if (existing.length === 0) {
        existing = await db
          .select({ recordId: schema.procurementRecords.recordId })
          .from(schema.procurementRecords)
          .where(eq(schema.procurementRecords.recordId, recordId))
          .limit(1);
      }
      if (existing.length > 0) {
        await db
          .update(schema.procurementRecords)
          .set({
            supplier: (data.supplier as string) ?? null,
            valueNgn:
              data.value_ngn !== undefined ? Number(data.value_ngn) : null,
            status: String(data.status ?? "unknown"),
          })
          .where(
            eq(schema.procurementRecords.recordId, existing[0].recordId),
          );
        counts.updated++;
      } else {
        await db.insert(schema.procurementRecords).values({
          recordId,
          jurisdictionId: String(data.jurisdiction_id),
          buyer: String(data.buyer ?? "unknown"),
          supplier: (data.supplier as string) ?? null,
          valueNgn: data.value_ngn !== undefined ? Number(data.value_ngn) : null,
          awardDate: (data.award_date as string) ?? null,
          status: String(data.status ?? "unknown"),
          ocid,
          origin: provenance.origin,
          sourceUrl: provenance.url ?? null,
          fetchedAt: toDate(provenance.fetched_at),
        });
        counts.inserted++;
      }
    } catch (err) {
      counts.errors.push(
        `procurement_record ${data.ocid ?? data.record_id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* data_sources                                                         */
/* ------------------------------------------------------------------ */

export async function upsertDataSources(
  rows: { data: Record<string, unknown>; provenance: Provenance }[],
): Promise<EntityCounts> {
  const db = getDb();
  const counts = empty();
  for (const { data, provenance } of rows) {
    try {
      const sourceId = String(data.source_id ?? provenance.source_id);
      const existing = await db
        .select({ sourceId: schema.dataSources.sourceId })
        .from(schema.dataSources)
        .where(eq(schema.dataSources.sourceId, sourceId))
        .limit(1);
      if (existing.length > 0) {
        await db
          .update(schema.dataSources)
          .set({
            name: String(data.name ?? sourceId),
            url: (data.url as string) ?? provenance.url ?? null,
            lastRefresh: toDate(provenance.fetched_at),
          })
          .where(eq(schema.dataSources.sourceId, sourceId));
        counts.updated++;
      } else {
        await db.insert(schema.dataSources).values({
          sourceId,
          name: String(data.name ?? sourceId),
          owner: (data.owner as string) ?? null,
          url: (data.url as string) ?? provenance.url ?? null,
          category: (data.category as string) ?? null,
          accessMethod: (data.access_method as string) ?? null,
          // §16 EvidenceSource registry metadata (DM-8): loader-registered
          // sources default to a conservative classification until a data
          // steward enriches the record via the admin console.
          license: (data.license as string) ?? "unclassified (pending steward review)",
          qualityScore:
            typeof data.quality_score === "number" ? data.quality_score : 50,
          privacyClassification: (data.privacy_classification as string) ?? "internal",
          lastRefresh: toDate(provenance.fetched_at),
        });
        counts.inserted++;
      }
    } catch (err) {
      counts.errors.push(
        `data_source ${data.source_id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* budgets (budget_line entities — feat-ng-connectors)                  */
/* ------------------------------------------------------------------ */

export async function upsertBudgets(
  rows: { data: Record<string, unknown>; provenance: Provenance }[],
): Promise<EntityCounts> {
  const db = getDb();
  const counts = empty();
  for (const { data, provenance } of rows) {
    try {
      const budgetId = String(
        data.budget_id ??
          `budget:${data.fiscal_year}:${data.mda}:${data.program_code ?? ""}`,
      );
      const existing = await db
        .select({ budgetId: schema.budgets.budgetId })
        .from(schema.budgets)
        .where(eq(schema.budgets.budgetId, budgetId))
        .limit(1);
      if (existing.length > 0) {
        // Update the appropriation figure only — preserve original provenance.
        await db
          .update(schema.budgets)
          .set({
            appropriatedNgn:
              data.amount_ngn !== undefined ? Number(data.amount_ngn) : null,
          })
          .where(eq(schema.budgets.budgetId, budgetId));
        counts.updated++;
      } else {
        await db.insert(schema.budgets).values({
          budgetId,
          jurisdictionId: String(data.jurisdiction_id),
          fiscalYear: Number(data.fiscal_year),
          mda: String(data.mda ?? "unknown"),
          sectorCode: (data.sector_code as string) ?? null,
          appropriatedNgn:
            data.amount_ngn !== undefined ? Number(data.amount_ngn) : null,
          source: [
            data.appropriation_type ?? "capital",
            data.program_code ?? "",
          ]
            .join(" ")
            .trim() || null,
          origin: provenance.origin,
          sourceUrl: provenance.url ?? null,
          fetchedAt: toDate(provenance.fetched_at),
        });
        counts.inserted++;
      }
    } catch (err) {
      counts.errors.push(
        `budget_line ${data.budget_id ?? data.mda}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* policy_documents (bill_document entities — feat-ng-connectors)       */
/* ------------------------------------------------------------------ */

export async function upsertPolicyDocuments(
  rows: { data: Record<string, unknown>; provenance: Provenance }[],
): Promise<EntityCounts> {
  const db = getDb();
  const counts = empty();
  for (const { data, provenance } of rows) {
    try {
      const documentId = String(data.document_id);
      const metadata = (data.metadata ?? null) as Record<
        string,
        unknown
      > | null;
      const existing = await db
        .select({ documentId: schema.policyDocuments.documentId })
        .from(schema.policyDocuments)
        .where(eq(schema.policyDocuments.documentId, documentId))
        .limit(1);
      if (existing.length > 0) {
        // Update stage-carrying metadata only — preserve original provenance.
        await db
          .update(schema.policyDocuments)
          .set({ metadata })
          .where(eq(schema.policyDocuments.documentId, documentId));
        counts.updated++;
      } else {
        await db.insert(schema.policyDocuments).values({
          documentId,
          title: String(data.title ?? documentId),
          jurisdictionId: String(data.jurisdiction_id),
          sourceUri:
            (data.source_url as string) ?? provenance.url ?? null,
          hash: (data.hash as string) ?? null,
          docType: String(data.document_type ?? "bill"),
          metadata,
          origin: provenance.origin,
          sourceUrl: provenance.url ?? null,
          fetchedAt: toDate(provenance.fetched_at),
        });
        counts.inserted++;
      }
    } catch (err) {
      counts.errors.push(
        `bill_document ${data.document_id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* Batch dispatch                                                       */
/* ------------------------------------------------------------------ */

export type CanonicalBatch = {
  sector_metrics?: { data: Record<string, unknown>; provenance: Provenance }[];
  facilities?: { data: Record<string, unknown>; provenance: Provenance }[];
  procurement_records?: {
    data: Record<string, unknown>;
    provenance: Provenance;
  }[];
  data_sources?: { data: Record<string, unknown>; provenance: Provenance }[];
  budgets?: { data: Record<string, unknown>; provenance: Provenance }[];
  policy_documents?: {
    data: Record<string, unknown>;
    provenance: Provenance;
  }[];
};

export type LoaderCounts = Record<
  | "sector_metrics"
  | "facilities"
  | "procurement_records"
  | "data_sources"
  | "budgets"
  | "policy_documents",
  { inserted: number; updated: number; errors: number }
> & { error_messages: string[] };

export async function loadCanonicalBatch(
  batch: CanonicalBatch,
): Promise<LoaderCounts> {
  const result = {
    sector_metrics: { inserted: 0, updated: 0, errors: 0 },
    facilities: { inserted: 0, updated: 0, errors: 0 },
    procurement_records: { inserted: 0, updated: 0, errors: 0 },
    data_sources: { inserted: 0, updated: 0, errors: 0 },
    budgets: { inserted: 0, updated: 0, errors: 0 },
    policy_documents: { inserted: 0, updated: 0, errors: 0 },
    error_messages: [] as string[],
  };
  const run = async (
    key: keyof CanonicalBatch,
    fn: (
      rows: { data: Record<string, unknown>; provenance: Provenance }[],
    ) => Promise<EntityCounts>,
  ) => {
    const rows = batch[key] ?? [];
    if (rows.length === 0) return;
    const c = await fn(rows);
    result[key].inserted = c.inserted;
    result[key].updated = c.updated;
    result[key].errors = c.errors.length;
    result.error_messages.push(...c.errors);
  };
  await run("sector_metrics", upsertSectorMetrics);
  await run("facilities", upsertFacilities);
  await run("procurement_records", upsertProcurementRecords);
  await run("data_sources", upsertDataSources);
  await run("budgets", upsertBudgets);
  await run("policy_documents", upsertPolicyDocuments);
  return result;
}

/* ------------------------------------------------------------------ */
/* Typed readers (canonical model — profile extensions)                */
/* ------------------------------------------------------------------ */

export async function budgetsForJurisdiction(
  jurisdictionId: string,
  opts?: { fiscalYear?: number },
) {
  const conds = [eq(schema.budgets.jurisdictionId, jurisdictionId)];
  if (opts?.fiscalYear)
    conds.push(eq(schema.budgets.fiscalYear, opts.fiscalYear));
  return getDb()
    .select()
    .from(schema.budgets)
    .where(and(...conds))
    .orderBy(desc(schema.budgets.fiscalYear), asc(schema.budgets.mda));
}

export async function budgetSummaryForJurisdiction(jurisdictionId: string) {
  const rows = await budgetsForJurisdiction(jurisdictionId);
  const byYear = new Map<
    number,
    { appropriated_ngn: number; released_ngn: number; lines: number }
  >();
  for (const r of rows) {
    const acc = byYear.get(r.fiscalYear) ?? {
      appropriated_ngn: 0,
      released_ngn: 0,
      lines: 0,
    };
    acc.appropriated_ngn += r.appropriatedNgn ?? 0;
    acc.released_ngn += r.releasedNgn ?? 0;
    acc.lines++;
    byYear.set(r.fiscalYear, acc);
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([fiscal_year, acc]) => ({ fiscal_year, ...acc }));
}

export async function officialsForJurisdiction(jurisdictionId: string) {
  return getDb()
    .select()
    .from(schema.officials)
    .where(eq(schema.officials.jurisdictionId, jurisdictionId))
    .orderBy(asc(schema.officials.role));
}

export async function activeProgramsForJurisdiction(jurisdictionId: string) {
  return getDb()
    .select()
    .from(schema.programs)
    .where(
      and(
        eq(schema.programs.jurisdictionId, jurisdictionId),
        eq(schema.programs.status, "active"),
      ),
    )
    .orderBy(desc(schema.programs.targetJobs));
}

export async function businessRegistrationsForJurisdiction(
  jurisdictionId: string,
  opts?: { lga?: string; limit?: number },
) {
  const conds = [
    eq(schema.businessRegistrations.jurisdictionId, jurisdictionId),
  ];
  if (opts?.lga) conds.push(eq(schema.businessRegistrations.lga, opts.lga));
  return getDb()
    .select()
    .from(schema.businessRegistrations)
    .where(and(...conds))
    .orderBy(asc(schema.businessRegistrations.name))
    .limit(opts?.limit ?? 100);
}

/* ------------------------------------------------------------------ */
/* Provenance-preferred metric read path (live > derived > seed)       */
/* ------------------------------------------------------------------ */

const ORIGIN_RANK: Record<string, number> = { live: 3, derived: 2, seed: 1 };

/**
 * Latest metric row per metric_key for a jurisdiction, preferring higher
 * provenance rank (live > derived > seed) when both exist, then the most
 * recent period. Response shape matches latestMetricsForJurisdiction.
 */
export async function latestMetricsPreferringLive(
  jurisdictionId: string,
  opts?: { periodTo?: string },
) {
  // Pack-style ids ("ng-kd") and seed-style ids ("jur:ng-kd") both appear;
  // live connector rows are loaded under the pack id, the seed corpus under
  // "jur:*" — read across both so live rows surface on the seed profile.
  const aliases = jurisdictionId.startsWith("jur:")
    ? [jurisdictionId, jurisdictionId.slice(4)]
    : [jurisdictionId, `jur:${jurisdictionId}`];
  const rows = await getDb()
    .select()
    .from(schema.sectorMetrics)
    .where(inArray(schema.sectorMetrics.jurisdictionId, aliases))
    .orderBy(asc(schema.sectorMetrics.metricKey));
  const best = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (opts?.periodTo && r.period > opts.periodTo) continue;
    const cur = best.get(r.metricKey);
    if (!cur) {
      best.set(r.metricKey, r);
      continue;
    }
    const rank = (x: typeof r) => ORIGIN_RANK[x.origin] ?? 0;
    if (
      rank(r) > rank(cur) ||
      (rank(r) === rank(cur) && r.period > cur.period)
    ) {
      best.set(r.metricKey, r);
    }
  }
  return [...best.values()];
}
