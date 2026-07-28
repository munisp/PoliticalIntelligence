import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../queries/connection";

/**
 * Data contract tests (DM-2, DM-5) — dbt-style assertions against the dev
 * database. Skipped entirely when DATABASE_URL is unset (unit-test job);
 * executed in the CI e2e job right after the seed step (see ci.yml).
 *
 * Contracts asserted:
 *  1. Natural keys are NOT NULL and UNIQUE (jurisdictions, laws, clauses,
 *     opportunities; composite uniqueness for sector_metrics).
 *  2. Referential integrity (clauses.law_id ∈ laws,
 *     sector_metrics.jurisdiction_id ∈ jurisdictions, citations endpoints
 *     ∈ clauses).
 *  3. Provenance validity: origin ∈ ('live','derived','seed') on every
 *     table that carries the provenance columns.
 *  4. Freshness floor: ≥1 live-origin sector_metrics row.
 *  5. Seed integrity floors: ≥23 admin_units under jur:ng-kd, ≥5 laws,
 *     ≥10 opportunities.
 */

const HAS_DB = Boolean(process.env.DATABASE_URL);

async function query<T = Record<string, unknown>>(
  statement: ReturnType<typeof sql>,
): Promise<T[]> {
  const [rows] = (await getDb().execute(statement)) as unknown as [T[]];
  return rows;
}

async function scalar(statement: ReturnType<typeof sql>): Promise<number> {
  const rows = await query<{ n: number | string }>(statement);
  return Number(rows[0]?.n ?? 0);
}

/** NULL or duplicate count for a single-column natural key. */
async function keyViolations(table: string, column: string): Promise<number> {
  return scalar(sql.raw(
    `SELECT COUNT(*) AS n FROM (
       SELECT \`${column}\` FROM \`${table}\`
       WHERE \`${column}\` IS NULL
       UNION ALL
       SELECT \`${column}\` FROM \`${table}\`
       GROUP BY \`${column}\` HAVING COUNT(*) > 1
     ) v`,
  ));
}

describe.skipIf(!HAS_DB)("data contracts (DM-2, DM-5)", () => {
  describe("natural keys: not-null + unique", () => {
    it("jurisdictions.jurisdiction_id", async () => {
      expect(await keyViolations("jurisdictions", "jurisdiction_id")).toBe(0);
    });
    it("laws.law_id", async () => {
      expect(await keyViolations("laws", "law_id")).toBe(0);
    });
    it("clauses.clause_id", async () => {
      expect(await keyViolations("clauses", "clause_id")).toBe(0);
    });
    it("opportunities.opportunity_id", async () => {
      expect(await keyViolations("opportunities", "opportunity_id")).toBe(0);
    });
    it("sector_metrics composite (jurisdiction, sector, metric, period)", async () => {
      const dupes = await scalar(sql.raw(
        `SELECT COUNT(*) AS n FROM (
           SELECT jurisdiction_id, sector_code, metric_key, period
           FROM sector_metrics
           GROUP BY jurisdiction_id, sector_code, metric_key, period
           HAVING COUNT(*) > 1
         ) v`,
      ));
      expect(dupes).toBe(0);
      const nulls = await scalar(sql.raw(
        `SELECT COUNT(*) AS n FROM sector_metrics
         WHERE jurisdiction_id IS NULL OR sector_code IS NULL
            OR metric_key IS NULL OR period IS NULL`,
      ));
      expect(nulls).toBe(0);
    });
  });

  describe("referential integrity", () => {
    it("clauses.law_id ∈ laws", async () => {
      const orphans = await scalar(sql.raw(
        `SELECT COUNT(*) AS n FROM clauses c
         LEFT JOIN laws l ON l.law_id = c.law_id
         WHERE l.law_id IS NULL`,
      ));
      expect(orphans).toBe(0);
    });
    it("sector_metrics.jurisdiction_id ∈ jurisdictions", async () => {
      const orphans = await scalar(sql.raw(
        `SELECT COUNT(*) AS n FROM sector_metrics m
         LEFT JOIN jurisdictions j ON j.jurisdiction_id = m.jurisdiction_id
         WHERE j.jurisdiction_id IS NULL`,
      ));
      expect(orphans).toBe(0);
    });
    it("citations endpoints ∈ clauses", async () => {
      const orphans = await scalar(sql.raw(
        `SELECT COUNT(*) AS n FROM (
           SELECT from_clause_id AS cid FROM citations
           UNION ALL
           SELECT to_clause_id AS cid FROM citations
         ) e
         LEFT JOIN clauses c ON c.clause_id = e.cid
         WHERE c.clause_id IS NULL`,
      ));
      expect(orphans).toBe(0);
    });
  });

  describe("provenance validity", () => {
    it("origin ∈ ('live','derived','seed') on every provenance-labeled table", async () => {
      const tables = (
        await query<{ table_name: string }>(sql.raw(
          `SELECT table_name FROM information_schema.columns
           WHERE table_schema = DATABASE() AND column_name = 'origin'`,
        ))
      ).map((r) => r.table_name);
      expect(tables.length).toBeGreaterThan(0);
      for (const table of tables) {
        const bad = await scalar(sql.raw(
          `SELECT COUNT(*) AS n FROM \`${table}\`
           WHERE origin NOT IN ('live','derived','seed') OR origin IS NULL`,
        ));
        expect(bad, `table ${table} has invalid origin values`).toBe(0);
      }
    });
  });

  describe("freshness floor", () => {
    it("≥1 live-origin sector_metrics row", async () => {
      const live = await scalar(sql.raw(
        `SELECT COUNT(*) AS n FROM sector_metrics WHERE origin = 'live'`,
      ));
      expect(live).toBeGreaterThanOrEqual(1);
    });
  });

  describe("seed integrity floors", () => {
    it("≥23 admin_units under jur:ng-kd", async () => {
      const n = await scalar(sql.raw(
        `SELECT COUNT(*) AS n FROM admin_units WHERE jurisdiction_id = 'jur:ng-kd'`,
      ));
      expect(n).toBeGreaterThanOrEqual(23);
    });
    it("≥5 laws", async () => {
      expect(await scalar(sql.raw(`SELECT COUNT(*) AS n FROM laws`))).toBeGreaterThanOrEqual(5);
    });
    it("≥10 opportunities", async () => {
      expect(await scalar(sql.raw(`SELECT COUNT(*) AS n FROM opportunities`))).toBeGreaterThanOrEqual(10);
    });
  });

  describe("canonical entity coverage (DM-2)", () => {
    it("budgets: rows present, natural key unique, jurisdiction refs valid", async () => {
      expect(await scalar(sql.raw(`SELECT COUNT(*) AS n FROM budgets`))).toBeGreaterThanOrEqual(1);
      expect(await keyViolations("budgets", "budget_id")).toBe(0);
      const orphans = await scalar(sql.raw(
        `SELECT COUNT(*) AS n FROM budgets b
         LEFT JOIN jurisdictions j ON j.jurisdiction_id = b.jurisdiction_id
         WHERE j.jurisdiction_id IS NULL`,
      ));
      expect(orphans).toBe(0);
    });
    it("officials: rows present, natural key unique", async () => {
      expect(await scalar(sql.raw(`SELECT COUNT(*) AS n FROM officials`))).toBeGreaterThanOrEqual(1);
      expect(await keyViolations("officials", "official_id")).toBe(0);
    });
    it("programs: rows present, natural key unique", async () => {
      expect(await scalar(sql.raw(`SELECT COUNT(*) AS n FROM programs`))).toBeGreaterThanOrEqual(1);
      expect(await keyViolations("programs", "program_id")).toBe(0);
    });
    it("business_registrations: rows present, natural key unique", async () => {
      expect(await scalar(sql.raw(`SELECT COUNT(*) AS n FROM business_registrations`))).toBeGreaterThanOrEqual(1);
      expect(await keyViolations("business_registrations", "registration_id")).toBe(0);
    });
  });

  describe("evidence-source registry metadata (DM-8)", () => {
    it("license present on every registered source", async () => {
      const missing = await scalar(sql.raw(
        `SELECT COUNT(*) AS n FROM data_sources WHERE license IS NULL OR license = ''`,
      ));
      expect(missing).toBe(0);
    });
    it("quality_score within 0–100 on every registered source", async () => {
      const bad = await scalar(sql.raw(
        `SELECT COUNT(*) AS n FROM data_sources
         WHERE quality_score IS NULL OR quality_score < 0 OR quality_score > 100`,
      ));
      expect(bad).toBe(0);
    });
    it("privacy_classification ∈ (public, internal, restricted)", async () => {
      const bad = await scalar(sql.raw(
        `SELECT COUNT(*) AS n FROM data_sources
         WHERE privacy_classification NOT IN ('public','internal','restricted')`,
      ));
      expect(bad).toBe(0);
    });
  });
});
