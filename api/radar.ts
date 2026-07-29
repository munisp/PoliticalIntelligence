import { z } from "zod";
import {
  impactScore,
  radarAlertsInput,
  radarAlertsOutput,
  radarScanInput,
  radarScanOutput,
  type MatchedStakeholder,
  type PolicyAlertSourceEntity,
  type PolicyAlertView,
} from "@contracts/radar";
import { registerEventSchema } from "@contracts/events";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { envelope, audit } from "./utils/envelope";
import { requireRole, filterReadable, type AuthedCtx } from "./utils/rbac";
import {
  alertsByIds,
  existingAlertIds,
  insertPolicyAlerts,
  listPolicyAlerts,
  recentBudgets,
  recentPolicyDocuments,
} from "./queries/radar";
import { allStakeholders } from "./queries/advocacy";
import { emitEvent } from "./utils/events";
import type { InsertPolicyAlert, PolicyAlert } from "@db/schema";

/**
 * I1 — Policy Radar (docs/INNOVATIONS.md §I1): weekly digest of new bills,
 * regulations and budget lines scored by a deterministic impact rubric
 * (sector keyword weight × instrument type × amount magnitude). Scans are
 * idempotent (alertId natural key) and emit the `policy.alert` extension
 * event for webhook fan-out; a weekly job handler ("radar.weeklyScan") is
 * registered in api/runner.ts.
 */

/* Extension topic (registered schema keeps the event catalog closed). */
export const POLICY_ALERT_TOPIC = "policy.alert";
registerEventSchema(
  POLICY_ALERT_TOPIC,
  z.looseObject({
    alert_id: z.string().min(1),
    sector: z.string().optional(),
    jurisdiction_id: z.string().nullish(),
    impact_score: z.number().optional(),
    source_entity: z.string().optional(),
    source_ref: z.string().optional(),
  }),
);

function toView(a: PolicyAlert): PolicyAlertView {
  return {
    alertId: a.alertId,
    jurisdictionId: a.jurisdictionId ?? null,
    sector: a.sector,
    sourceEntity: a.sourceEntity,
    sourceRef: a.sourceRef,
    title: a.title,
    summary: a.summary ?? null,
    impactScore: a.impactScore,
    matchedStakeholders:
      (a.matchedStakeholders as MatchedStakeholder[] | null) ?? [],
    createdAt: a.createdAt,
    origin: a.origin,
  };
}

/** Stakeholders whose sector tags match the alert sector (max 5). */
function matchStakeholders(
  stakeholders: { stakeholderId: string; name: string; kind: string; sectorTags: unknown }[],
  sector: string,
  text: string,
): MatchedStakeholder[] {
  const lc = text.toLowerCase();
  return stakeholders
    .map((s) => {
      const tags = (s.sectorTags as string[] | null) ?? [];
      const score =
        tags.filter((t) => t.toLowerCase() === sector).length * 2 +
        tags.filter((t) => lc.includes(t.toLowerCase())).length;
      return { s, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ s }) => ({ stakeholderId: s.stakeholderId, name: s.name, kind: s.kind }));
}

export interface RadarScanResult {
  scanned: number;
  inserted: number;
  alerts: PolicyAlertView[];
}

/**
 * Deterministic scan shared by the tRPC mutation and the weekly job.
 * Reads policy_documents (bill/regulation by docType) + budgets created
 * within `days`, scores each, and inserts missing alerts.
 */
export async function runRadarScan(
  input: { days: number; jurisdiction_id?: string },
): Promise<RadarScanResult> {
  const since = new Date(Date.now() - input.days * 24 * 3600 * 1000);
  const [docs, budgets, stakeholders] = await Promise.all([
    recentPolicyDocuments(since, input.jurisdiction_id),
    recentBudgets(since, input.jurisdiction_id),
    allStakeholders(),
  ]);

  const candidates: InsertPolicyAlert[] = [];
  for (const d of docs) {
    const docType = (d.docType ?? "").toLowerCase();
    const sourceEntity: PolicyAlertSourceEntity =
      docType === "regulation" ? "regulation" : "bill";
    const text = `${d.title} ${d.docType ?? ""}`;
    const { score, sector } = impactScore({ text, sourceEntity });
    candidates.push({
      alertId: `alert:${sourceEntity}:${d.documentId}`,
      jurisdictionId: d.jurisdictionId,
      sector,
      sourceEntity,
      sourceRef: d.documentId,
      title: d.title,
      summary: `New ${sourceEntity} detected by Policy Radar scan (${input.days}d window).`,
      impactScore: score,
      matchedStakeholders: matchStakeholders(stakeholders, sector, text),
      origin: "derived",
    });
  }
  for (const b of budgets) {
    const text = `${b.mda} ${b.sectorCode ?? ""} budget ${b.fiscalYear}`;
    const { score, sector } = impactScore({
      text,
      sourceEntity: "budget",
      appropriatedNgn: b.appropriatedNgn ?? null,
    });
    candidates.push({
      alertId: `alert:budget:${b.budgetId}`,
      jurisdictionId: b.jurisdictionId,
      sector,
      sourceEntity: "budget",
      sourceRef: b.budgetId,
      title: `${b.mda} — FY${b.fiscalYear} appropriation`,
      summary: `₦${(b.appropriatedNgn ?? 0).toLocaleString("en-NG")} appropriated (₦${(b.releasedNgn ?? 0).toLocaleString("en-NG")} released).`,
      impactScore: score,
      matchedStakeholders: matchStakeholders(stakeholders, sector, text),
      origin: "derived",
    });
  }

  // Idempotent insert (alertId natural key). Event fan-out for newly
  // created alerts lives in runRadarScanWithEvents (exact pre/post diff).
  const inserted = await insertPolicyAlerts(candidates);
  // Hydrate exactly the alerts this scan touched (by natural key) — robust
  // against a large pre-existing alert corpus (no limit-200 truncation).
  const views = (
    await alertsByIds(candidates.map((c) => c.alertId))
  ).map(toView);

  return radarScanOutput.parse({
    scanned: docs.length + budgets.length,
    inserted,
    alerts: views,
  });
}

/**
 * Scan + event fan-out: emits `policy.alert` for each alert that did not
 * exist before the call (exact pre/post diff — deterministic).
 */
export async function runRadarScanWithEvents(
  input: { days: number; jurisdiction_id?: string },
): Promise<RadarScanResult> {
  const since = new Date(Date.now() - input.days * 24 * 3600 * 1000);
  const [docs, budgets] = await Promise.all([
    recentPolicyDocuments(since, input.jurisdiction_id),
    recentBudgets(since, input.jurisdiction_id),
  ]);
  const preIds = new Set([
    ...docs.map((d) => `alert:${(d.docType ?? "").toLowerCase() === "regulation" ? "regulation" : "bill"}:${d.documentId}`),
    ...budgets.map((b) => `alert:budget:${b.budgetId}`),
  ]);
  const pre = await existingAlertIds([...preIds]);
  const result = await runRadarScan(input);
  // Fan-out cap: the alert ROWS are all persisted; webhook events are emitted
  // for the first 50 new alerts per scan so a first-ever scan over a large
  // seeded corpus does not flood subscribers (digest semantics preserved).
  const MAX_EVENTS_PER_SCAN = 50;
  let emitted = 0;
  for (const a of result.alerts) {
    if (!pre.has(a.alertId) && emitted < MAX_EVENTS_PER_SCAN) {
      emitted += 1;
      await emitEvent(POLICY_ALERT_TOPIC, {
        alert_id: a.alertId,
        sector: a.sector,
        jurisdiction_id: a.jurisdictionId,
        impact_score: a.impactScore,
        source_entity: a.sourceEntity,
        source_ref: a.sourceRef,
      });
    }
  }
  return result;
}

export const radarRouter = createRouter({
  /**
   * Alert feed. ABAC-scoped: authenticated non-global actors see alerts in
   * their granted jurisdictions plus platform-level (null jurisdiction)
   * alerts; the anonymous public facade sees the unfiltered feed.
   */
  alerts: publicQuery
    .input(radarAlertsInput)
    .query(async ({ ctx, input }) => {
      const since = input.since ? new Date(input.since) : undefined;
      let jurisdictionIds: string[] | undefined;
      if (ctx.user) {
        const { accessibleJurisdictionIds, assertJurisdictionAccess } =
          await import("./utils/rbac");
        if (input.jurisdiction_id) {
          await assertJurisdictionAccess(
            ctx as AuthedCtx,
            input.jurisdiction_id,
            "read",
          );
        } else {
          const acc = await accessibleJurisdictionIds(ctx as AuthedCtx);
          if (acc !== null) jurisdictionIds = acc;
        }
      }
      const rows = await listPolicyAlerts({
        sector: input.sector,
        jurisdictionId: input.jurisdiction_id,
        since,
        limit: input.limit,
      });
      // filterReadable keeps platform-level (null) alerts for everyone.
      const scoped = ctx.user
        ? await filterReadable(ctx as AuthedCtx, rows, (a) => a.jurisdictionId)
        : rows;
      const scopedByGrant =
        jurisdictionIds === undefined
          ? scoped
          : scoped.filter(
              (a) =>
                a.jurisdictionId === null ||
                jurisdictionIds!.includes(a.jurisdictionId),
            );
      return envelope(
        radarAlertsOutput.parse({
          alerts: scopedByGrant.slice(0, input.limit).map(toView),
        }),
        ctx,
      );
    }),

  /**
   * Manual scan (policy_analyst). Deterministic rubric; idempotent insert;
   * emits `policy.alert` webhook events for newly created alerts.
   */
  scan: authedQuery
    .input(radarScanInput)
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["policy_analyst", "data_steward"]);
      const result = await runRadarScanWithEvents(input);
      audit(ctx, "radar.scan", {
        type: "policy_alerts",
        id: input.jurisdiction_id ?? "all",
        scopes: ["radar:scan"],
        payload: { days: input.days, scanned: result.scanned, inserted: result.inserted },
      });
      return envelope(result, ctx);
    }),
});
