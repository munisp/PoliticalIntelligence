import { beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import * as schema from "@db/schema";
import { templatePublishInput } from "@contracts/innovations";
import {
  seedLagosCalabar,
  CORRIDOR_OPPORTUNITIES,
  CORRIDOR_TEMPLATE,
  CORRIDOR_STATES,
  LCH_LAYERS,
  EV,
} from "@db/seed-lagos-calabar";

/**
 * Lagos–Calabar corridor seed integrity (docs/DEMO-LAGOS-CALABAR.md).
 * Runs the pack's idempotent upsert against the dev DB, then asserts the
 * funded-project → opportunities contract: ≥18 opportunities, ≥6 technology
 * layer, non-empty evidence everywhere, budget ↔ financing evidence linkage,
 * and a scenario template that validates against its zod contract.
 */

const db = getDb();

beforeAll(async () => {
  await seedLagosCalabar();
});

async function corridorOpps() {
  return db
    .select()
    .from(schema.opportunities)
    .where(inArray(schema.opportunities.opportunityId, CORRIDOR_OPPORTUNITIES.map((o) => o.opportunityId)));
}

describe("lagos-calabar corridor seed", () => {
  it("seeds ≥18 corridor opportunities, idempotently", async () => {
    const rows = await corridorOpps();
    expect(rows.length).toBeGreaterThanOrEqual(18);
    expect(rows.length).toBe(CORRIDOR_OPPORTUNITIES.length);
    // Re-run is a no-op for row counts (idempotent upsert).
    await seedLagosCalabar();
    expect((await corridorOpps()).length).toBe(rows.length);
  });

  it("flags ≥6 opportunities with layer=technology", () => {
    const tech = CORRIDOR_OPPORTUNITIES.filter(
      (o) => LCH_LAYERS[o.opportunityId] === "technology",
    );
    expect(tech.length).toBeGreaterThanOrEqual(6);
    // Layer is also visible in the UI-facing summary tag.
    for (const o of tech) {
      expect(o.summary).toContain("[layer:technology |");
    }
  });

  it("every opportunity has a non-empty evidence_base citing pack evidence sources", async () => {
    const rows = await corridorOpps();
    const packEvidenceIds = new Set<string>(Object.values(EV));
    for (const row of rows) {
      const refs = (row.evidenceRefs ?? []) as string[];
      expect(refs.length, row.opportunityId).toBeGreaterThan(0);
      expect(
        refs.some((r) => packEvidenceIds.has(r)),
        `${row.opportunityId} cites a pack evidence source`,
      ).toBe(true);
    }
  });

  it("budget row is derived-provenance and linked to the financing evidence", async () => {
    const [row] = await db
      .select()
      .from(schema.budgets)
      .where(inArray(schema.budgets.budgetId, ["bud:ng-2025-fmw-coastal-highway"]));
    expect(row).toBeDefined();
    expect(row.mda).toBe("Federal Ministry of Works");
    expect(row.origin).toBe("derived");
    expect(row.source).toBe(EV.financing);
    // Consistent with the $1.126B Section 2 financing (₦, not millions).
    expect(row.appropriatedNgn).toBeGreaterThan(1_000_000_000_000);
    expect(row.sourceUrl).toBeTruthy();
  });

  it("seeds the 9 corridor-state jurisdictions", async () => {
    const slugs = ["la", "og", "on", "de", "ba", "ri", "ak", "cr", "ed"];
    const rows = await db
      .select()
      .from(schema.jurisdictions)
      .where(inArray(schema.jurisdictions.jurisdictionId, slugs.map((s) => `jur:ng-${s}`)));
    expect(rows.length).toBe(9);
    expect(CORRIDOR_STATES).toHaveLength(9);
  });

  it("scenario template exists and validates against its zod contract", async () => {
    const row = await db.query.scenarioTemplates.findFirst({
      where: (t, { eq }) => eq(t.templateId, CORRIDOR_TEMPLATE.templateId),
    });
    expect(row).toBeDefined();
    expect(row!.name).toBe("Lagos–Calabar corridor build-out");
    const parsed = templatePublishInput
      .pick({ name: true, description: true, config: true })
      .safeParse({ name: row!.name, description: row!.description, config: row!.config });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.config.horizon_months).toBe(84);
      expect(parsed.data.config.intervention_ids.length).toBeGreaterThanOrEqual(2);
    }
    // Assumptions reference the financing scale + corridor targeting.
    const cfg = row!.config as Record<string, unknown>;
    const assumptions = cfg.assumptions as Record<string, unknown>;
    expect(assumptions.financing_usd).toBe(1_126_000_000);
    expect(assumptions.instruments).toEqual(
      expect.arrayContaining(["infrastructure_investment", "logistics_policy"]),
    );
  });
});
