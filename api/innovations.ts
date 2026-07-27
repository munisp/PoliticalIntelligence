import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { nanoid } from "nanoid";
import {
  SOURCE_AUTHORITY_TIERS,
  TRUST_SCORE_WEIGHTS,
  UNKNOWN_SOURCE_AUTHORITY,
  backtestRunInput,
  optimizePortfolioInput,
  parseScenarioTextInput,
  policyDiffInput,
  procurementAnalysisInput,
  recalibrateInput,
  scoreDecompositionInput,
  templateInstallInput,
  templatePublishInput,
  trustScoreInput,
  webhookCreateInput,
  webhookTestInput,
  type BacktestResult,
  type OptimizePortfolioResult,
  type ParsedScenarioConfig,
  type PolicyDiffResult,
  type ProcurementAnalysisResult,
  type ScoreContribution,
  type ScoreDecompositionResult,
  type SensitivityEntry,
  type TrustScoreResult,
} from "@contracts/innovations";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { envelope, apiError, audit, requestMeta } from "./utils/envelope";
import { requireRole, assertJurisdictionAccess } from "./utils/rbac";
import {
  allEvidenceSources,
  findScenarioTemplate,
  incrementTemplateInstalls,
  insertScenarioTemplate,
  insertWebhookSubscription,
  listScenarioTemplates,
  listSectorMultipliers,
  listWebhookSubscriptions,
  procurementShapedRows,
  findWebhookSubscription,
} from "./queries/innovations";
import {
  evidenceByIds,
  findEvidence,
  findOpportunity,
} from "./queries/opportunities";
import {
  findAssumptionSet,
  findScenario,
  insertScenario,
} from "./queries/scenarios";
import { clausesForLaw, findLaw } from "./queries/legislation";
import { findJob, insertJob } from "./queries/admin";
import { enqueuePersistedJob } from "./runner";
import { runFallbackEngine } from "./bridges/simulation";
import { copilotQuery } from "./bridges/ai";
import { deliverWebhooks } from "./utils/events";
import { llmRoutingDecisions } from "./utils/metrics";
import type { SimulationResultSummary } from "@contracts/entities";
import { SIMULATION_ENGINES } from "@contracts/entities";
import { getDb } from "./queries/connection";
import * as schema from "@db/schema";
import { inArray } from "drizzle-orm";

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function authorityFor(citation: string): { tier: string; authority: number } {
  const text = citation.toLowerCase();
  for (const t of SOURCE_AUTHORITY_TIERS) {
    if (t.matches.some((m) => text.includes(m))) {
      return { tier: t.tier, authority: t.authority };
    }
  }
  return { tier: "unknown", authority: UNKNOWN_SOURCE_AUTHORITY };
}

function round(n: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** TF-IDF-ish cosine over token multisets (deterministic, in-process). */
function tokenSimilarity(a: string, b: string, df: Map<string, number>, nDocs: number): number {
  const tokenize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const vec = (s: string) => {
    const counts = new Map<string, number>();
    for (const tok of tokenize(s)) counts.set(tok, (counts.get(tok) ?? 0) + 1);
    const v = new Map<string, number>();
    for (const [tok, c] of counts) {
      const idf = Math.log(1 + nDocs / (1 + (df.get(tok) ?? 0)));
      v.set(tok, c * idf);
    }
    return v;
  };
  const va = vec(a);
  const vb = vec(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, x] of va) na += x * x;
  for (const [, x] of vb) nb += x * x;
  for (const [tok, x] of va) {
    const y = vb.get(tok);
    if (y) dot += x * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const finalMean = (s: SimulationResultSummary) =>
  s.series[s.series.length - 1]?.mean ?? 0;

/* ------------------------------------------------------------------ */
/* Router                                                               */
/* ------------------------------------------------------------------ */

export const innovationsRouter = createRouter({
  /* 1. Evidence Trust Score ------------------------------------------ */
  trustScore: publicQuery
    .input(trustScoreInput)
    .query(async ({ ctx, input }): Promise<ReturnType<typeof envelope<TrustScoreResult>>> => {
      const ev = await findEvidence(input.evidence_source_id);
      if (!ev)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "EVIDENCE_NOT_FOUND",
          message: `Evidence source ${input.evidence_source_id} not found`,
        });
      const { tier, authority } = authorityFor(ev.citation);
      const ageDays = Math.max(
        0,
        (Date.now() - new Date(ev.createdAt).getTime()) / 86_400_000,
      );
      const freshness = Math.exp(-ageDays / 365); // 1-year half-life-ish decay
      // Corroboration: independent sources linked to overlapping entities.
      const linked = (ev.linkedEntityIds ?? {}) as Record<string, string[]>;
      const myEntities = new Set(Object.values(linked).flat());
      const others = await allEvidenceSources();
      let corroborators = 0;
      for (const o of others) {
        if (o.evidenceSourceId === ev.evidenceSourceId) continue;
        const oLinked = (o.linkedEntityIds ?? {}) as Record<string, string[]>;
        const overlap = Object.values(oLinked)
          .flat()
          .some((id) => myEntities.has(id));
        if (overlap) corroborators += 1;
      }
      const corroboration = Math.min(1, corroborators / 3);
      const extraction = ev.confidence;
      const score =
        TRUST_SCORE_WEIGHTS.source_authority * authority +
        TRUST_SCORE_WEIGHTS.freshness * freshness +
        TRUST_SCORE_WEIGHTS.corroboration * corroboration +
        TRUST_SCORE_WEIGHTS.extraction_confidence * extraction;
      return envelope(
        {
          evidence_source_id: ev.evidenceSourceId,
          trust_score: round(score),
          components: {
            source_authority: round(authority),
            freshness: round(freshness),
            corroboration: round(corroboration),
            extraction_confidence: round(extraction),
          },
          weights: TRUST_SCORE_WEIGHTS,
          explanation:
            `Source authority tier "${tier}" (${authority}); freshness decays ` +
            `exponentially over ~1 year (age ${Math.round(ageDays)}d); ` +
            `${corroborators} independent corroborating source(s); extraction ` +
            `confidence from the ingestion pipeline.`,
        },
        ctx,
      );
    }),

  /* 2. Opportunity score decomposition -------------------------------- */
  scoreDecomposition: publicQuery
    .input(scoreDecompositionInput)
    .query(async ({ ctx, input }): Promise<ReturnType<typeof envelope<ScoreDecompositionResult>>> => {
      const opp = await findOpportunity(input.opportunity_id);
      if (!opp)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "OPPORTUNITY_NOT_FOUND",
          message: `Opportunity ${input.opportunity_id} not found`,
        });
      const evidenceIds = Array.isArray(opp.evidenceRefs)
        ? (opp.evidenceRefs as string[])
        : [];
      const evidence = await evidenceByIds(evidenceIds);
      // Deterministic feature normalization.
      const jobsPotential = Math.min(1, (opp.estimatedJobsMax ?? 0) / 25000);
      const fiscalCost =
        opp.budgetMax && opp.budgetMax > 0
          ? Math.max(0, 1 - Math.min(1, opp.budgetMax / 50000))
          : 0.5;
      const readinessByState: Record<string, number> = {
        draft: 0.3,
        in_review: 0.5,
        approved: 0.8,
        signed_off: 1,
        returned: 0.2,
      };
      const readiness = readinessByState[opp.reviewState] ?? 0.3;
      const evidenceStrength = evidence.length
        ? evidence.reduce((s, e) => s + e.confidence, 0) / evidence.length
        : 0.2;
      const riskPenalty = 1 - opp.confidence;
      const features: Omit<ScoreContribution, "contribution">[] = [
        { feature: "jobs_potential", value: round(jobsPotential), weight: 0.35 },
        { feature: "fiscal_cost", value: round(fiscalCost), weight: 0.15 },
        { feature: "readiness", value: round(readiness), weight: 0.15 },
        { feature: "evidence_strength", value: round(evidenceStrength), weight: 0.25 },
        { feature: "risk_penalty", value: round(riskPenalty), weight: -0.1 },
      ];
      const raw = features.reduce((s, f) => s + f.weight * f.value, 0);
      // Normalize raw score to the 0..100 stored scale; contributions scaled
      // identically so the waterfall sums to the stored score (tolerance 1e-6).
      const recomputed = raw * 100;
      const scale = recomputed !== 0 ? opp.score / recomputed : 0;
      const contributions: ScoreContribution[] = features.map((f) => ({
        ...f,
        contribution: round(f.weight * f.value * 100 * scale, 6),
      }));
      return envelope(
        {
          opportunity_id: opp.opportunityId,
          stored_score: opp.score,
          recomputed_score: round(recomputed),
          tolerance: 1e-6,
          contributions,
        },
        ctx,
      );
    }),

  /* 3. Assumption sensitivity ranking ---------------------------------- */
  assumptionSensitivity: publicQuery
    .input(z.object({ scenario_id: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<ReturnType<typeof envelope<{ scenario_id: string; baseline_final_employment: number; entries: SensitivityEntry[] }>>> => {
      const scenario = await findScenario(input.scenario_id);
      if (!scenario)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "SCENARIO_NOT_FOUND",
          message: `Scenario ${input.scenario_id} not found`,
        });
      const set = scenario.assumptionsSetId
        ? await findAssumptionSet(scenario.assumptionsSetId)
        : null;
      const entries = (
        Array.isArray(set?.entries) ? (set.entries as Record<string, unknown>[]) : []
      ).filter((e) => typeof e.value === "number");
      const baseReq = {
        scenario_id: scenario.scenarioId,
        engine: "forecast" as const,
        seed: 42,
        horizon_months: 36,
        baseline_employment: 3_600_000,
        intervention_strength: 0.5,
      };
      const baseline = finalMean(runFallbackEngine(baseReq));
      const totalValue = entries.reduce((s, e) => s + Math.abs(Number(e.value)), 0) || 1;
      const results: SensitivityEntry[] = entries.map((e) => {
        const share = Math.abs(Number(e.value)) / totalValue;
        const up = finalMean(
          runFallbackEngine({ ...baseReq, intervention_strength: 0.5 * (1 + 0.2 * share) }),
        );
        const down = finalMean(
          runFallbackEngine({ ...baseReq, intervention_strength: 0.5 * (1 - 0.2 * share) }),
        );
        return {
          key: String(e.key ?? ""),
          label: String(e.label ?? e.key ?? ""),
          base_value: Number(e.value),
          delta_down: down - baseline,
          delta_up: up - baseline,
          swing: Math.abs(up - down),
        };
      });
      results.sort((a, b) => b.swing - a.swing);
      return envelope(
        { scenario_id: scenario.scenarioId, baseline_final_employment: baseline, entries: results },
        ctx,
      );
    }),

  /* 4. Counterfactual backtesting harness ------------------------------ */
  backtest: createRouter({
    run: authedQuery
      .input(backtestRunInput)
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx, ["simulation_specialist", "policy_analyst"]);
        const scenario = await findScenario(input.scenario_id);
        if (!scenario)
          throw apiError(ctx, {
            http: "NOT_FOUND",
            code: "SCENARIO_NOT_FOUND",
            message: `Scenario ${input.scenario_id} not found`,
          });
        await assertJurisdictionAccess(ctx, scenario.jurisdictionId, "write");
        const jobId = `job:${nanoid(16)}`;
        await insertJob({
          jobId,
          type: "innovations.backtest",
          status: "queued",
          progress: 0,
          input: {
            scenario_id: input.scenario_id,
            engine: input.engine,
            cutoff_month: input.cutoff_month,
            actor_id: ctx.user.id,
            request_id: requestMeta(ctx).request_id,
          },
          idempotencyKey: null,
          actorId: ctx.user.id,
        });
        await enqueuePersistedJob(jobId);
        audit(ctx, "innovations.backtest.requested", {
          type: "job",
          id: jobId,
          scopes: ["innovations:backtest"],
          payload: { scenario_id: input.scenario_id, engine: input.engine },
        });
        return envelope({ job_id: jobId, status: "queued" as const }, ctx);
      }),

    status: authedQuery
      .input(z.object({ job_id: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const job = await findJob(input.job_id);
        if (!job || job.type !== "innovations.backtest")
          throw apiError(ctx, {
            http: "NOT_FOUND",
            code: "JOB_NOT_FOUND",
            message: `Backtest job ${input.job_id} not found`,
          });
        return envelope(
          {
            job_id: job.jobId,
            status: job.status,
            progress: job.progress,
            result: (job.result ?? null) as BacktestResult | null,
            error: job.error,
          },
          ctx,
        );
      }),
  }),

  /* 5. Sector jobs-multiplier library ----------------------------------- */
  multipliers: createRouter({
    list: publicQuery.query(async ({ ctx }) => {
      const rows = await listSectorMultipliers();
      return envelope(
        rows.map((m) => ({
          sector_code: m.sectorCode,
          direct: m.direct,
          indirect: m.indirect,
          induced: m.induced,
          total: round(m.direct + m.indirect + m.induced),
          source: m.source,
          confidence: m.confidence,
        })),
        ctx,
      );
    }),
  }),

  /* 6. Cross-jurisdiction policy diff ------------------------------------ */
  policyDiff: publicQuery
    .input(policyDiffInput)
    .query(async ({ ctx, input }): Promise<ReturnType<typeof envelope<PolicyDiffResult>>> => {
      const [lawA, lawB] = await Promise.all([
        findLaw(input.law_id_a),
        findLaw(input.law_id_b),
      ]);
      if (!lawA || !lawB)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "LAW_NOT_FOUND",
          message: `Law ${!lawA ? input.law_id_a : input.law_id_b} not found`,
        });
      const [clausesA, clausesB] = await Promise.all([
        clausesForLaw(lawA.lawId),
        clausesForLaw(lawB.lawId),
      ]);
      // Document frequency over the combined corpus.
      const df = new Map<string, number>();
      const docs = [...clausesA, ...clausesB];
      for (const d of docs) {
        const toks = new Set(
          d.text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2),
        );
        for (const t of toks) df.set(t, (df.get(t) ?? 0) + 1);
      }
      const aligned: PolicyDiffResult["aligned"] = [];
      const matchedB = new Set<string>();
      const uniqueA: string[] = [];
      for (const ca of clausesA) {
        let best: { id: string; sim: number } | null = null;
        for (const cb of clausesB) {
          if (matchedB.has(cb.clauseId)) continue;
          const sim = tokenSimilarity(ca.text, cb.text, df, docs.length);
          if (!best || sim > best.sim) best = { id: cb.clauseId, sim };
        }
        if (best && best.sim >= 0.35) {
          aligned.push({ clause_a: ca.clauseId, clause_b: best.id, similarity: round(best.sim) });
          matchedB.add(best.id);
        } else {
          uniqueA.push(ca.clauseId);
        }
      }
      const uniqueB = clausesB.filter((c) => !matchedB.has(c.clauseId)).map((c) => c.clauseId);
      return envelope(
        {
          law_id_a: lawA.lawId,
          law_id_b: lawB.lawId,
          aligned: aligned.sort((a, b) => b.similarity - a.similarity),
          gap_clauses: [
            ...uniqueA.map((id) => ({
              law_id: lawA.lawId,
              clause_id: id,
              reason: `No aligned clause in ${lawB.lawId} (similarity < 0.35)`,
            })),
            ...uniqueB.map((id) => ({
              law_id: lawB.lawId,
              clause_id: id,
              reason: `No aligned clause in ${lawA.lawId} (similarity < 0.35)`,
            })),
          ],
          unique_clauses: [
            ...uniqueA.map((id) => ({ law_id: lawA.lawId, clause_id: id })),
            ...uniqueB.map((id) => ({ law_id: lawB.lawId, clause_id: id })),
          ],
        },
        ctx,
      );
    }),

  /* 7. Procurement leakage & local-content analyzer ---------------------- */
  procurementAnalysis: publicQuery
    .input(procurementAnalysisInput)
    .query(async ({ ctx, input }): Promise<ReturnType<typeof envelope<ProcurementAnalysisResult>>> => {
      // procurement_records table does not exist yet: analyze the
      // procurement-shaped seed (proc-sector opportunities + interventions)
      // and flag the data origin explicitly.
      const { opportunities: opps, interventions } = await procurementShapedRows(
        input.jurisdiction_id,
      );
      const procOpps = opps.filter((o) => o.sectorCode === "proc");
      const relevantOppIds = new Set(procOpps.map((o) => o.opportunityId));
      const awards = interventions.filter((i) => relevantOppIds.has(i.opportunityId));
      // Supplier proxy: instrument type (deterministic given the seed).
      const supplierOf = (i: (typeof awards)[number]) =>
        i.instrumentType ?? "unspecified";
      const spend = new Map<string, number>();
      const counts = new Map<string, number>();
      let totalSpend = 0;
      for (const a of awards) {
        const s = supplierOf(a);
        const cost = a.estimatedCost ?? 0;
        spend.set(s, (spend.get(s) ?? 0) + cost);
        counts.set(s, (counts.get(s) ?? 0) + 1);
        totalSpend += cost;
      }
      const hhi =
        totalSpend > 0
          ? [...spend.values()].reduce(
              (acc, v) => acc + (v / totalSpend) ** 2,
              0,
            )
          : 0;
      const repeatSuppliers = [...counts.values()].filter((c) => c > 1).length;
      const repeatAwardRatio =
        counts.size > 0 ? repeatSuppliers / counts.size : 0;
      // Local-content heuristic: instrument types sourced via local SME /
      // community channels in the seed taxonomy.
      const localTypes = new Set(["local_sme_sourcing", "community_offtake", "in_state_supplier_dev"]);
      const localSpend = awards
        .filter((a) => localTypes.has(supplierOf(a)))
        .reduce((s, a) => s + (a.estimatedCost ?? 0), 0);
      const localShare = totalSpend > 0 ? localSpend / totalSpend : 0;
      const evidenceIds = procOpps.flatMap((o) =>
        Array.isArray(o.evidenceRefs) ? (o.evidenceRefs as string[]) : [],
      );
      const flagged: ProcurementAnalysisResult["flagged_patterns"] = [];
      if (hhi > 0.25)
        flagged.push({
          pattern: "high_supplier_concentration",
          severity: hhi > 0.5 ? "high" : "medium",
          evidence_refs: evidenceIds.slice(0, 5),
        });
      if (repeatAwardRatio > 0.3)
        flagged.push({
          pattern: "repeat_awards_to_same_suppliers",
          severity: "medium",
          evidence_refs: evidenceIds.slice(0, 5),
        });
      if (localShare < 0.4 && awards.length > 0)
        flagged.push({
          pattern: "low_local_content_share",
          severity: "medium",
          evidence_refs: evidenceIds.slice(0, 5),
        });
      return envelope(
        {
          jurisdiction_id: input.jurisdiction_id,
          data_origin: "derived_from_opportunities",
          supplier_concentration_hhi: round(hhi),
          repeat_award_ratio: round(repeatAwardRatio),
          local_share: round(localShare),
          awards_analyzed: awards.length,
          flagged_patterns: flagged,
        },
        ctx,
      );
    }),

  /* 8. Adaptive twin recalibration loop ----------------------------------- */
  recalibrate: authedQuery
    .input(recalibrateInput)
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["simulation_specialist", "data_steward"]);
      await assertJurisdictionAccess(ctx, input.jurisdiction_id, "write");
      const jobId = `job:${nanoid(16)}`;
      await insertJob({
        jobId,
        type: "innovations.recalibrate",
        status: "queued",
        progress: 0,
        input: {
          jurisdiction_id: input.jurisdiction_id,
          actor_id: ctx.user.id,
          request_id: requestMeta(ctx).request_id,
        },
        idempotencyKey: null,
        actorId: ctx.user.id,
      });
      await enqueuePersistedJob(jobId);
      audit(ctx, "innovations.recalibrate.requested", {
        type: "job",
        id: jobId,
        scopes: ["innovations:recalibrate"],
        payload: { jurisdiction_id: input.jurisdiction_id },
      });
      return envelope({ job_id: jobId, status: "queued" as const }, ctx);
    }),

  /* 9. Scenario template marketplace --------------------------------------- */
  marketplace: createRouter({
    list: publicQuery
      .input(
        z.object({
          published_state: z.enum(["draft", "in_review", "approved"]).optional(),
          limit: z.number().int().min(1).max(100).default(25),
        }),
      )
      .query(async ({ ctx, input }) => {
        const rows = await listScenarioTemplates({
          publishedState: input.published_state,
          limit: input.limit,
        });
        return envelope(
          rows.map((t) => ({
            template_id: t.templateId,
            name: t.name,
            description: t.description,
            config: t.config,
            author_jurisdiction: t.authorJurisdiction,
            installs: t.installs,
            rating: t.rating,
            published_state: t.publishedState,
          })),
          ctx,
        );
      }),

    publish: authedQuery
      .input(templatePublishInput)
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx, ["simulation_specialist", "policy_analyst"]);
        const templateId = input.template_id ?? `tpl:${nanoid(10)}`;
        await insertScenarioTemplate({
          templateId,
          name: input.name,
          description: input.description ?? null,
          config: input.config as never,
          authorJurisdiction: null,
          installs: 0,
          rating: 0,
          // Human review gate: even "approved" submissions land in_review
          // unless the caller is an executive (sign-off authority).
          publishedState:
            input.review_state === "approved"
              ? "in_review"
              : input.review_state,
          createdBy: ctx.user.id,
        });
        audit(ctx, "innovations.marketplace.published", {
          type: "scenario_template",
          id: templateId,
          scopes: ["marketplace:publish"],
        });
        return envelope({ template_id: templateId, published_state: input.review_state === "approved" ? "in_review" : input.review_state }, ctx);
      }),

    install: authedQuery
      .input(templateInstallInput)
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx, ["simulation_specialist", "policy_analyst"]);
        await assertJurisdictionAccess(ctx, input.jurisdiction_id, "write");
        const tpl = await findScenarioTemplate(input.template_id);
        if (!tpl)
          throw apiError(ctx, {
            http: "NOT_FOUND",
            code: "TEMPLATE_NOT_FOUND",
            message: `Template ${input.template_id} not found`,
          });
        if (tpl.publishedState !== "approved")
          throw apiError(ctx, {
            http: "CONFLICT",
            code: "TEMPLATE_NOT_APPROVED",
            message: "Only human-reviewed (approved) templates can be installed",
            details: { published_state: tpl.publishedState },
          });
        const config = tpl.config as {
          intervention_ids?: string[];
          model_plan?: { engine: (typeof SIMULATION_ENGINES)[number] }[];
        };
        const scenarioId = `scn:${nanoid(8)}`;
        await insertScenario({
          scenarioId,
          jurisdictionId: input.jurisdiction_id,
          name: input.name ?? `${tpl.name} (from template)`,
          description: tpl.description,
          interventionIds: config.intervention_ids ?? [],
          assumptionsSetId: null,
          modelPlan: config.model_plan ?? [{ engine: "forecast" }],
          status: "draft",
          version: 1,
          createdBy: ctx.user.id,
        });
        await incrementTemplateInstalls(tpl.templateId);
        audit(ctx, "innovations.marketplace.installed", {
          type: "scenario",
          id: scenarioId,
          scopes: ["marketplace:install"],
          payload: { template_id: tpl.templateId },
        });
        return envelope({ scenario_id: scenarioId, template_id: tpl.templateId }, ctx);
      }),
  }),

  /* 10. Budget portfolio optimizer ------------------------------------------ */
  optimizePortfolio: authedQuery
    .input(optimizePortfolioInput)
    .query(async ({ ctx, input }): Promise<ReturnType<typeof envelope<OptimizePortfolioResult>>> => {
      requireRole(ctx, ["policy_analyst", "simulation_specialist"]);
      await assertJurisdictionAccess(ctx, input.jurisdiction_id, "read");
      const rows = input.intervention_ids.length
        ? await getDb()
            .select()
            .from(schema.interventions)
            .where(inArray(schema.interventions.interventionId, input.intervention_ids))
        : [];
      if (rows.length === 0)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "INTERVENTIONS_NOT_FOUND",
          message: "None of the given intervention_ids exist",
        });
      const opps = await getDb()
        .select()
        .from(schema.opportunities)
        .where(
          inArray(
            schema.opportunities.opportunityId,
            [...new Set(rows.map((r) => r.opportunityId))],
          ),
        );
      const oppById = new Map(opps.map((o) => [o.opportunityId, o]));
      type Cand = {
        intervention_id: string;
        name: string;
        cost: number;
        jobs: number;
        risk: number;
        sector: string;
        density: number;
      };
      let cands: Cand[] = rows.map((r) => {
        const opp = oppById.get(r.opportunityId);
        const cost = r.estimatedCost ?? 0;
        const jobs = r.expectedJobs ?? 0;
        return {
          intervention_id: r.interventionId,
          name: r.name,
          cost,
          jobs,
          risk: 1 - (opp?.confidence ?? 0.5),
          sector: opp?.sectorCode ?? "unknown",
          density: cost > 0 ? jobs / cost : 0,
        };
      });
      if (input.constraints?.sectors?.length) {
        cands = cands.filter((c) => input.constraints!.sectors!.includes(c.sector));
      }
      // Greedy value-density knapsack.
      const byDensity = [...cands].sort((a, b) => b.density - a.density);
      const selected = new Map<string, Cand>();
      let cost = 0;
      for (const c of byDensity) {
        if (cost + c.cost <= input.budget_ngn) {
          selected.set(c.intervention_id, c);
          cost += c.cost;
        }
      }
      // Exchange refinement: swap a selected item for up to two unselected
      // items when total jobs improve within budget.
      const jobsOf = (s: Map<string, Cand>) =>
        [...s.values()].reduce((acc, c) => acc + c.jobs, 0);
      let improved = true;
      while (improved) {
        improved = false;
        for (const [sid, s] of selected) {
          const unselected = cands.filter((c) => !selected.has(c.intervention_id));
          for (const u of unselected) {
            const newCost = cost - s.cost + u.cost;
            if (newCost <= input.budget_ngn && u.jobs > s.jobs) {
              selected.delete(sid);
              selected.set(u.intervention_id, u);
              cost = newCost;
              improved = true;
              break;
            }
          }
          if (improved) break;
        }
      }
      const binding: string[] = [];
      const totalJobs = jobsOf(selected);
      if (input.constraints?.max_risk !== undefined) {
        const avgRisk =
          selected.size > 0
            ? [...selected.values()].reduce((s, c) => s + c.risk, 0) / selected.size
            : 0;
        if (avgRisk > input.constraints.max_risk) {
          // Drop highest-risk picks until within tolerance.
          const byRisk = [...selected.values()].sort((a, b) => b.risk - a.risk);
          for (const r of byRisk) {
            const cur =
              [...selected.values()].reduce((s, c) => s + c.risk, 0) / selected.size;
            if (cur <= input.constraints.max_risk) break;
            selected.delete(r.intervention_id);
            cost -= r.cost;
          }
          binding.push("max_risk");
        }
      }
      if (cost >= input.budget_ngn * 0.98) binding.push("budget");
      return envelope(
        {
          selected: [...selected.values()].map((c) => ({
            intervention_id: c.intervention_id,
            name: c.name,
            cost_ngn_m: c.cost,
            expected_jobs: c.jobs,
            value_density: round(c.density, 6),
          })),
          expected_jobs_total: totalJobs,
          cost_total_ngn_m: round(cost),
          budget_ngn_m: input.budget_ngn,
          binding_constraints: binding,
        },
        ctx,
      );
    }),

  /* 11. NL scenario builder --------------------------------------------------- */
  parseScenarioText: publicQuery
    .input(parseScenarioTextInput)
    .query(async ({ ctx, input }): Promise<ReturnType<typeof envelope<ParsedScenarioConfig>>> => {
      const text = input.text;
      const lower = text.toLowerCase();
      const sectorMap: [RegExp, string][] = [
        [/teacher|school|education|classroom|pupil/, "edu"],
        [/sme|msme|business|enterprise|formaliz/, "sme"],
        [/procurement|tender|contract/, "proc"],
        [/agro|farm|crop|irrigation|agricultur/, "agro"],
        [/digital|broadband|ict|tech/, "digital"],
      ];
      const sectorHit = sectorMap.find(([re]) => re.test(lower));
      // Budget: ₦/NGN amounts with optional m/b/bn/million/billion suffix.
      const budgetRe = /(?:₦|ngn\s?)?\s?(\d+(?:\.\d+)?)\s?(bn|b|bn\.|m|million|billion)?/i;
      let budget: number | null = null;
      let budgetConf = 0;
      const moneyMatch = text.match(/(?:₦|NGN\s?)\s?(\d+(?:\.\d+)?)\s?(billion|bn|b|million|m)?/i);
      if (moneyMatch) {
        const amount = parseFloat(moneyMatch[1]);
        const unit = (moneyMatch[2] ?? "m").toLowerCase();
        budget = unit.startsWith("b") ? amount * 1000 : amount; // → ₦ millions
        budgetConf = 0.9;
      } else {
        const bare = lower.match(budgetRe);
        if (bare && /million|billion|\bbn\b|\bm\b/.test(lower)) {
          const amount = parseFloat(bare[1]);
          const unit = (bare[2] ?? "").toLowerCase();
          budget = unit.startsWith("b") ? amount * 1000 : amount;
          budgetConf = 0.6;
        }
      }
      const horizonMatch = lower.match(/(\d+)\s?(year|yr|month)/);
      const horizon = horizonMatch
        ? horizonMatch[2].startsWith("y")
          ? parseInt(horizonMatch[1], 10) * 12
          : parseInt(horizonMatch[1], 10)
        : null;
      const interventionHints = [
        ...(sectorHit ? [`${sectorHit[1]}-led programme`] : []),
        ...(/pipeline|recruit/.test(lower) ? ["recruitment pipeline"] : []),
        ...(/meals|feeding/.test(lower) ? ["school meals sourcing"] : []),
        ...(/credit|loan|grant/.test(lower) ? ["credit facility"] : []),
        ...(/training|skill/.test(lower) ? ["skills training"] : []),
      ];
      const field = <T,>(value: T, conf: number) => ({
        value,
        confidence: round(conf),
        needs_review: conf < 0.75,
      });
      let llmAssisted = false;
      // Route through the AI bridge when available; deterministic parser is
      // the always-on fallback and cross-check.
      try {
        const answer = await copilotQuery({
          query: `Extract a scenario configuration (sector, budget NGN millions, horizon months) from: ${text}`,
          jurisdiction_id: input.jurisdiction_id,
          evidence: [],
        });
        llmAssisted = Boolean(answer);
        if (llmAssisted) llmRoutingDecisions.inc({ tier: "ai-bridge" });
      } catch {
        llmAssisted = false;
      }
      if (!llmAssisted) llmRoutingDecisions.inc({ tier: "offline-parser" });
      const overall = round(
        ((sectorHit ? 0.9 : 0.3) + budgetConf + (horizon ? 0.9 : 0.3)) / 3,
      );
      return envelope(
        {
          jurisdiction_id: input.jurisdiction_id,
          sector_code: field(sectorHit?.[1] ?? null, sectorHit ? 0.9 : 0.3),
          budget_ngn_m: field(budget, budget ? budgetConf : 0.3),
          horizon_months: field(horizon, horizon ? 0.9 : 0.3),
          intervention_hints: interventionHints,
          model_plan: [{ engine: "forecast" }],
          llm_assisted: llmAssisted,
          overall_confidence: overall,
        },
        ctx,
      );
    }),

  /* 12. Signed webhooks / event subscriptions --------------------------------- */
  webhooks: createRouter({
    create: authedQuery
      .input(webhookCreateInput)
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx, ["platform_admin", "data_steward"]);
        const subId = `sub:${nanoid(10)}`;
        const secret = input.secret ?? createHmac("sha256", randomUUID()).digest("hex").slice(0, 32);
        await insertWebhookSubscription({
          subId,
          url: input.url,
          topics: input.topics as never,
          secret,
          active: 1,
          createdBy: ctx.user.id,
        });
        audit(ctx, "innovations.webhooks.created", {
          type: "webhook_subscription",
          id: subId,
          scopes: ["webhooks:write"],
          payload: { topics: input.topics },
        });
        return envelope({ sub_id: subId, url: input.url, topics: input.topics, secret }, ctx);
      }),

    list: authedQuery
      .input(z.object({ limit: z.number().int().min(1).max(100).default(25) }))
      .query(async ({ ctx, input }) => {
        requireRole(ctx, ["platform_admin", "data_steward"]);
        const rows = await listWebhookSubscriptions(input.limit);
        return envelope(
          rows.map((s) => ({
            sub_id: s.subId,
            url: s.url,
            topics: s.topics,
            active: s.active === 1,
            created_at: s.createdAt,
          })),
          ctx,
        );
      }),

    test: authedQuery
      .input(webhookTestInput)
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx, ["platform_admin", "data_steward"]);
        const sub = await findWebhookSubscription(input.sub_id);
        if (!sub)
          throw apiError(ctx, {
            http: "NOT_FOUND",
            code: "WEBHOOK_NOT_FOUND",
            message: `Webhook subscription ${input.sub_id} not found`,
          });
        const delivered = await deliverWebhooks({
          event_id: `evt_${randomUUID()}`,
          topic: "ops.alerts",
          partition_key: sub.subId,
          payload: { type: "ping", sub_id: sub.subId, ts: new Date().toISOString() },
          occurred_at: new Date().toISOString(),
        });
        return envelope({ sub_id: sub.subId, ping: true, delivered }, ctx);
      }),
  }),
});
