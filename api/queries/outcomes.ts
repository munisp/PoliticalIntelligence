/**
 * Realized-outcome store queries (feature G2 — docs/OUTCOMES.md).
 *
 * outcome_series / outcome_observations hold REALIZED indicator values
 * (e.g. NBS labour-force releases) that feed real-data causal estimation
 * and backtesting in the simulation service.
 *
 * Loader upserts are select-then-write (same rationale as queries/canonical:
 * TiDB does not report affectedRows update semantics reliably through
 * onDuplicateKeyUpdate), keyed by the natural keys:
 *   series      (jurisdiction_id, indicator_code, source, frequency)
 *   observation (series_id, period)
 * Replays are idempotent: an existing (series, period) updates value +
 * provenance; the series row itself is stable.
 */
import { and, asc, eq, gte, lte } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import type { Provenance } from "./canonical";

export type OutcomeCounts = {
  inserted: number;
  updated: number;
  /** Error COUNT (messages are returned separately in error_messages). */
  errors: number;
};

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function listSeriesForJurisdiction(jurisdictionId: string) {
  return getDb()
    .select()
    .from(schema.outcomeSeries)
    .where(eq(schema.outcomeSeries.jurisdictionId, jurisdictionId))
    .orderBy(asc(schema.outcomeSeries.indicatorCode));
}

export async function observationsForSeries(
  seriesId: number,
  from?: string,
  to?: string,
) {
  const conds = [eq(schema.outcomeObservations.seriesId, seriesId)];
  if (from) conds.push(gte(schema.outcomeObservations.period, from));
  if (to) conds.push(lte(schema.outcomeObservations.period, to));
  return getDb()
    .select()
    .from(schema.outcomeObservations)
    .where(and(...conds))
    .orderBy(asc(schema.outcomeObservations.period));
}

/* ------------------------------------------------------------------ */
/* Loader upsert                                                       */
/* ------------------------------------------------------------------ */

export type OutcomeObservationInput = {
  jurisdiction_id: string;
  indicator_code: string;
  unit: string;
  frequency: "monthly" | "quarterly" | "annual";
  source?: string;
  period: string; // YYYY-MM
  value: number;
};

async function findOrCreateSeries(
  rec: OutcomeObservationInput,
  provenance: Provenance,
): Promise<{ id: number; created: boolean }> {
  const db = getDb();
  const source = rec.source ?? provenance.source_id ?? "unknown";
  const existing = await db
    .select()
    .from(schema.outcomeSeries)
    .where(
      and(
        eq(schema.outcomeSeries.jurisdictionId, rec.jurisdiction_id),
        eq(schema.outcomeSeries.indicatorCode, rec.indicator_code),
        eq(schema.outcomeSeries.source, source),
        eq(schema.outcomeSeries.frequency, rec.frequency),
      ),
    )
    .limit(1);
  if (existing.length > 0) return { id: existing[0].id, created: false };
  const inserted = await db.insert(schema.outcomeSeries).values({
    jurisdictionId: rec.jurisdiction_id,
    indicatorCode: rec.indicator_code,
    source,
    origin: provenance.origin,
    unit: rec.unit,
    frequency: rec.frequency,
  });
  // serial id — mysql2 returns it as insertId.
  const id = Number((inserted as unknown as [{ insertId: number | string }])[0].insertId);
  return { id, created: true };
}

/**
 * Upsert a batch of realized outcome observations. Returns per-entity
 * counts keyed "observations" (plus series_created) so the ingestion
 * loader can aggregate like any other canonical batch.
 */
export async function upsertOutcomeObservations(
  rows: { data: Record<string, unknown>; provenance: Provenance }[],
): Promise<{
  counts: Record<string, OutcomeCounts>;
  error_messages: string[];
}> {
  const db = getDb();
  const counts = { inserted: 0, updated: 0 };
  const errorMessages: string[] = [];
  let seriesCreated = 0;
  for (const { data, provenance } of rows) {
    try {
      const rec: OutcomeObservationInput = {
        jurisdiction_id: String(data.jurisdiction_id),
        indicator_code: String(data.indicator_code),
        unit: String(data.unit),
        frequency: data.frequency as OutcomeObservationInput["frequency"],
        source: data.source ? String(data.source) : undefined,
        period: String(data.period),
        value: Number(data.value),
      };
      if (!PERIOD_RE.test(rec.period)) {
        throw new Error(`period '${rec.period}' is not YYYY-MM`);
      }
      if (!Number.isFinite(rec.value)) {
        throw new Error(`value '${data.value}' is not numeric`);
      }
      const series = await findOrCreateSeries(rec, provenance);
      if (series.created) seriesCreated += 1;
      const existing = await db
        .select()
        .from(schema.outcomeObservations)
        .where(
          and(
            eq(schema.outcomeObservations.seriesId, series.id),
            eq(schema.outcomeObservations.period, rec.period),
          ),
        )
        .limit(1);
      const provJson = {
        origin: provenance.origin,
        source_id: provenance.source_id ?? null,
        url: provenance.url ?? null,
      };
      if (existing.length > 0) {
        await db
          .update(schema.outcomeObservations)
          .set({
            value: rec.value,
            fetchedAt: toDate(provenance.fetched_at) ?? new Date(),
            provenanceJson: provJson,
          })
          .where(eq(schema.outcomeObservations.id, existing[0].id));
        counts.updated += 1;
      } else {
        await db.insert(schema.outcomeObservations).values({
          seriesId: series.id,
          period: rec.period,
          value: rec.value,
          fetchedAt: toDate(provenance.fetched_at) ?? new Date(),
          provenanceJson: provJson,
        });
        counts.inserted += 1;
      }
    } catch (err) {
      errorMessages.push(
        `outcome_observation ${String(data.indicator_code)}@${String(data.period)}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return {
    counts: {
      observations: {
        inserted: counts.inserted,
        updated: counts.updated,
        errors: errorMessages.length,
      },
      series: { inserted: seriesCreated, updated: 0, errors: 0 },
    },
    error_messages: errorMessages,
  };
}
