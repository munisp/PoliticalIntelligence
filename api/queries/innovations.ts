import { and, asc, desc, eq, inArray } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

/* --------------------------- sector multipliers ----------------------- */

export async function listSectorMultipliers() {
  return getDb()
    .select()
    .from(schema.sectorMultipliers)
    .orderBy(asc(schema.sectorMultipliers.sectorCode));
}

export async function findSectorMultiplier(sectorCode: string) {
  return getDb().query.sectorMultipliers.findFirst({
    where: eq(schema.sectorMultipliers.sectorCode, sectorCode),
  });
}

/* ------------------------------ twin states --------------------------- */

export async function twinStatesFor(jurisdictionId: string) {
  return getDb()
    .select()
    .from(schema.twinStates)
    .where(eq(schema.twinStates.jurisdictionId, jurisdictionId));
}

export async function upsertTwinState(row: {
  jurisdictionId: string;
  layer: string;
  state: unknown;
  version: number;
  calibratedAt: Date;
}) {
  await getDb()
    .insert(schema.twinStates)
    .values({
      jurisdictionId: row.jurisdictionId,
      layer: row.layer,
      state: row.state as never,
      version: row.version,
      calibratedAt: row.calibratedAt,
    })
    .onDuplicateKeyUpdate({
      set: {
        state: row.state as never,
        version: row.version,
        calibratedAt: row.calibratedAt,
      },
    });
}

/* -------------------------- scenario templates ------------------------ */

export async function listScenarioTemplates(filters: {
  publishedState?: string;
  limit: number;
}) {
  const conds = [];
  if (filters.publishedState)
    conds.push(eq(schema.scenarioTemplates.publishedState, filters.publishedState));
  return getDb()
    .select()
    .from(schema.scenarioTemplates)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.scenarioTemplates.installs))
    .limit(filters.limit);
}

export async function findScenarioTemplate(templateId: string) {
  return getDb().query.scenarioTemplates.findFirst({
    where: eq(schema.scenarioTemplates.templateId, templateId),
  });
}

export async function insertScenarioTemplate(
  row: typeof schema.scenarioTemplates.$inferInsert,
) {
  await getDb().insert(schema.scenarioTemplates).values(row);
}

export async function incrementTemplateInstalls(templateId: string) {
  const t = await findScenarioTemplate(templateId);
  if (!t) return;
  await getDb()
    .update(schema.scenarioTemplates)
    .set({ installs: t.installs + 1 })
    .where(eq(schema.scenarioTemplates.templateId, templateId));
}

/* ------------------------------- webhooks ----------------------------- */

export async function listWebhookSubscriptions(limit: number) {
  return getDb()
    .select()
    .from(schema.webhookSubscriptions)
    .orderBy(desc(schema.webhookSubscriptions.createdAt))
    .limit(limit);
}

export async function findWebhookSubscription(subId: string) {
  return getDb().query.webhookSubscriptions.findFirst({
    where: eq(schema.webhookSubscriptions.subId, subId),
  });
}

export async function insertWebhookSubscription(
  row: typeof schema.webhookSubscriptions.$inferInsert,
) {
  await getDb().insert(schema.webhookSubscriptions).values(row);
}

/* --------------------- evidence corroboration ------------------------- */

/** Evidence sources linked to any of the same entities (corroboration). */
export async function allEvidenceSources(limit = 500) {
  return getDb().select().from(schema.evidenceSources).limit(limit);
}

/* ------------------------ procurement analysis ------------------------ */

/** Procurement-shaped opportunities + interventions for a jurisdiction. */
export async function procurementShapedRows(jurisdictionId: string) {
  const opps = await getDb()
    .select()
    .from(schema.opportunities)
    .where(eq(schema.opportunities.jurisdictionId, jurisdictionId));
  const oppIds = opps.map((o) => o.opportunityId);
  const interventions = oppIds.length
    ? await getDb()
        .select()
        .from(schema.interventions)
        .where(inArray(schema.interventions.opportunityId, oppIds))
    : [];
  return { opportunities: opps, interventions };
}

/* ------------------------- backtest / metrics ------------------------- */

export async function metricsForJurisdiction(jurisdictionId: string) {
  return getDb()
    .select()
    .from(schema.sectorMetrics)
    .where(eq(schema.sectorMetrics.jurisdictionId, jurisdictionId))
    .orderBy(asc(schema.sectorMetrics.period));
}
