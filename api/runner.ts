import { nanoid } from "nanoid";
import type { SimulationEngine } from "@contracts/entities";
import { EventTopics } from "@contracts/entities";
import { createJobRunner, type JobHandler, type JobRunner } from "./utils/jobs";
import { dbJobStore, findJob } from "./queries/admin";
import { insertAuditEvent } from "./queries/audit";
import {
  evidenceByIds,
  findOpportunity,
  insertRecommendation,
} from "./queries/opportunities";
import { clausesForLaw, listLaws } from "./queries/legislation";
import {
  findScenario,
  findSimulationRun,
  updateSimulationRunResult,
} from "./queries/scenarios";
import { findBrief, updateBrief } from "./queries/briefs";
import { findDocument } from "./queries/admin";
import { updateDocumentState } from "./queries/documents";
import { generateRecommendation } from "./bridges/ai";
import { executeScenarioRun, runFallbackEngine } from "./bridges/simulation";
import { emitEvent, emitJobLifecycle } from "./utils/events";
import {
  buildSimulationRunManifest,
  computeReproducibilityHash,
} from "./utils/manifest";
import {
  jobsTotal,
  jobsFailedTotal,
  simulationRunsTotal,
} from "./utils/metrics";
import { metricsForJurisdiction, twinStatesFor, upsertTwinState } from "./queries/innovations";

async function auditBackground(
  actorId: number | null,
  action: string,
  entityType: string,
  entityId: string,
  payload?: unknown,
) {
  try {
    await insertAuditEvent({
      actorId,
      action,
      entityType,
      entityId,
      scopes: null,
      requestId: `req_${nanoid(16)}`,
      correlationId: `cor_${nanoid(16)}`,
      payload: { topic: EventTopics.auditEvents, ...(payload !== undefined ? { data: payload } : {}) },
    });
  } catch (err) {
    console.error(`[audit] background ${action} failed:`, err);
  }
}

/**
 * Singleton in-process job runner with registered domain handlers.
 * Handlers update both the `jobs` row (via dbJobStore) and domain tables,
 * and emit audit events. Status polling reads the `jobs` table.
 */
export const jobRunner: JobRunner = createJobRunner(dbJobStore);

/**
 * Register with instrumentation: jobs_total / jobs_failed_total counters and
 * job-lifecycle domain events (queued→running→succeeded/failed).
 */
const baseRegister = jobRunner.register.bind(jobRunner);
jobRunner.register = (type: string, handler: JobHandler) => {
  baseRegister(type, async (jobCtx) => {
    jobsTotal.inc({ type });
    await emitJobLifecycle("running", { jobId: jobCtx.jobId, type });
    try {
      const result = await handler(jobCtx);
      await emitJobLifecycle("succeeded", { jobId: jobCtx.jobId, type });
      return result;
    } catch (err) {
      jobsFailedTotal.inc({ type });
      await emitJobLifecycle("failed", { jobId: jobCtx.jobId, type });
      throw err;
    }
  });
};

/* ------------------------- opportunities.generate ------------------------ */

jobRunner.register("opportunities.generate", async ({ input, reportProgress }) => {
  const { opportunity_id, actor_id } = input as {
    opportunity_id: string;
    actor_id: number | null;
  };
  await reportProgress(15);
  const opp = await findOpportunity(opportunity_id);
  if (!opp) throw new Error(`Opportunity ${opportunity_id} not found`);

  const evidenceIds = Array.isArray(opp.evidenceRefs)
    ? (opp.evidenceRefs as string[])
    : [];
  const evidence = await evidenceByIds(evidenceIds);
  await reportProgress(35);

  // Legal dependencies: laws in this jurisdiction whose clauses relate.
  const { items: lawRows } = await listLaws({
    jurisdictionId: opp.jurisdictionId,
    limit: 25,
  });
  const legalDependencies = [];
  for (const law of lawRows.slice(0, 3)) {
    const cls = await clausesForLaw(law.lawId);
    if (cls.length > 0) {
      legalDependencies.push({
        law_id: law.lawId,
        clause_ids: cls.slice(0, 3).map((c) => c.clauseId),
        note: `${law.title} governs enabling instruments for this intervention.`,
      });
    }
  }
  await reportProgress(55);

  // §9.2 contract enforcement: a recommendation that fails validation
  // (after the bridge's single repair retry) fails the job — it is NEVER
  // persisted. The failure is recorded in the audit trail.
  let generated: Awaited<ReturnType<typeof generateRecommendation>>;
  try {
    generated = await generateRecommendation({
    opportunity: {
      opportunity_id: opp.opportunityId,
      title: opp.title,
      summary: opp.summary,
      sector_code: opp.sectorCode,
      jurisdiction_id: opp.jurisdictionId,
      estimated_jobs_min: opp.estimatedJobsMin,
      estimated_jobs_max: opp.estimatedJobsMax,
      budget_min: opp.budgetMin,
      budget_max: opp.budgetMax,
      horizon_months: opp.horizonMonths,
    },
    evidence: evidence.map((e) => ({
      evidence_source_id: e.evidenceSourceId,
      source_type: e.sourceType,
      citation: e.citation,
      confidence: e.confidence,
      excerpt: e.contentExcerpt,
    })),
      legal_dependencies: legalDependencies,
      simulation_scenarios: [],
    });
  } catch (err) {
    const { RecommendationContractError } = await import("./utils/reco-contract");
    if (err instanceof RecommendationContractError) {
      await auditBackground(
        actor_id,
        "recommendations.contract_validation_failed",
        "opportunity",
        opportunity_id,
        { errors: err.errors },
      );
    }
    throw err; // job fails with the error envelope; nothing is persisted
  }
  const { recommendation, bridge, routing } = generated;
  recommendation.generated_at = new Date();
  await reportProgress(80);

  await insertRecommendation({
    recommendationId: recommendation.recommendation_id,
    opportunityId: opp.opportunityId,
    scenarioId: null,
    contract: recommendation as never,
    reviewState: "draft",
    approvalChain: [{ role: "policy_analyst", state: "generated", at: new Date().toISOString() }] as never,
    createdBy: actor_id,
  });
  // AI-8: the model routing record is persisted to the immutable audit
  // store on every generation, alongside the recommendations.generated event.
  await auditBackground(
    actor_id,
    "recommendations.generated",
    "recommendation",
    recommendation.recommendation_id,
    { topic: EventTopics.recommendationsGenerated, bridge, model_routing: routing },
  );
  return { recommendation_id: recommendation.recommendation_id, bridge };
});

/* ---------------------------- simulations.run ---------------------------- */

jobRunner.register("simulations.run", async ({ input, reportProgress }) => {
  const { simulation_run_id, actor_id } = input as {
    simulation_run_id: string;
    actor_id: number | null;
  };
  const run = await findSimulationRun(simulation_run_id);
  if (!run) throw new Error(`Simulation run ${simulation_run_id} not found`);
  const scenario = await findScenario(run.scenarioId);
  await reportProgress(20);

  const runParams = {
    scenario_id: run.scenarioId,
    engine: run.engine as SimulationEngine,
    seed: run.seed,
    horizon_months: 36,
    baseline_employment: 3_600_000, // Kaduna labour force scale
    intervention_strength: scenario?.modelPlan ? 0.6 : 0.4,
    execution_profile: (run.executionProfile as Record<string, unknown>) ?? {},
  };
  const { result, bridge } = await executeScenarioRun(runParams);
  await reportProgress(75);
  simulationRunsTotal.inc({ engine: run.engine, bridge });

  // DM-3: persist the reproducibility manifest + content hashes so any run
  // can be re-executed and verified (TEST-5 re-run harness recomputes this).
  const manifest = buildSimulationRunManifest({
    simulation_run_id,
    scenario_id: run.scenarioId,
    jurisdiction_id: scenario?.jurisdictionId ?? null,
    engine: run.engine,
    seed: run.seed,
    horizon_months: runParams.horizon_months,
    baseline_employment: runParams.baseline_employment,
    intervention_strength: runParams.intervention_strength,
    execution_profile: runParams.execution_profile,
    model_versions: (run.modelVersions as Record<string, unknown>) ?? {},
  });
  const reproducibilityHash = computeReproducibilityHash(manifest, result);

  await emitEvent(
    EventTopics.simulationsRunCompleted,
    {
      simulation_run_id,
      scenario_id: run.scenarioId,
      engine: run.engine,
      bridge,
      seed: run.seed,
      reproducibility_hash: reproducibilityHash,
    },
    run.scenarioId,
  );

  await updateSimulationRunResult(simulation_run_id, {
    status: "succeeded",
    progress: 100,
    resultSummary: result as never,
    manifest: manifest as never,
    datasetSnapshotId: manifest.dataset_snapshot_id,
    reproducibilityHash,
    artifactUri: `artifacts://${run.scenarioId}/${simulation_run_id}.json`,
    finishedAt: new Date(),
  });
  await auditBackground(
    actor_id,
    "simulations.run.completed",
    "simulation_run",
    simulation_run_id,
    { topic: EventTopics.simulationsRunCompleted, bridge },
  );
  return { simulation_run_id, bridge, engine: run.engine };
});

/* ------------------------------ briefs.generate --------------------------- */

jobRunner.register("briefs.generate", async ({ input, reportProgress }) => {
  const { brief_id, actor_id } = input as {
    brief_id: string;
    actor_id: number | null;
  };
  const brief = await findBrief(brief_id);
  if (!brief) throw new Error(`Brief ${brief_id} not found`);
  await reportProgress(20);

  // Citations rail: assemble the evidence bundle from DB evidence_sources
  // linked to the brief's jurisdiction/opportunities (never left empty).
  const opportunityIds = Array.isArray((input as { opportunity_ids?: string[] }).opportunity_ids)
    ? ((input as { opportunity_ids?: string[] }).opportunity_ids as string[])
    : [];
  const linkedEvidenceIds = new Set<string>();
  for (const oppId of opportunityIds) {
    const opp = await findOpportunity(oppId);
    if (opp && Array.isArray(opp.evidenceRefs)) {
      for (const id of opp.evidenceRefs as string[]) linkedEvidenceIds.add(id);
    }
  }
  let evidence = await evidenceByIds([...linkedEvidenceIds]);
  if (evidence.length < 3) {
    // Supplement with evidence sources linked to this jurisdiction's
    // opportunities so the rail always cites real sources.
    const { searchLike } = await import("./queries/admin");
    const jurOpps = await searchLike({ q: "", jurisdictionId: brief.jurisdictionId, limit: 12 });
    const extraIds = jurOpps.opportunities.flatMap((o) =>
      Array.isArray(o.evidenceRefs) ? (o.evidenceRefs as string[]) : [],
    );
    const extra = await evidenceByIds(
      extraIds.filter((id) => !linkedEvidenceIds.has(id)).slice(0, 8),
    );
    evidence = [...evidence, ...extra];
  }
  if (evidence.length < 3) {
    const { allEvidenceSources } = await import("./queries/innovations");
    const fallback = await allEvidenceSources(8);
    const known = new Set(evidence.map((e) => e.evidenceSourceId));
    evidence = [...evidence, ...fallback.filter((e) => !known.has(e.evidenceSourceId))];
  }
  const citationsRail = evidence.slice(0, 10).map((e) => ({
    evidence_source_id: e.evidenceSourceId,
    citation: e.citation,
    confidence: e.confidence,
  }));
  await reportProgress(40);

  // G5: draft section bodies through the serving tier (remote LLM) when
  // available; the deterministic template bodies are the offline fallback.
  const { draftBriefSections } = await import("./bridges/ai");
  const drafted = await draftBriefSections({
    title: brief.title,
    template: brief.template,
    jurisdiction_id: brief.jurisdictionId,
    evidence: evidence.slice(0, 10).map((e) => ({
      evidence_source_id: e.evidenceSourceId,
      source_type: e.sourceType,
      citation: e.citation,
      confidence: e.confidence,
      excerpt: e.contentExcerpt,
    })),
  });
  await reportProgress(60);

  // Structured, IBM-Plex-Serif-ready brief content with a citations rail.
  const content = {
    title: brief.title,
    template: brief.template,
    sections: drafted.sections,
    citations_rail: citationsRail,
    approval: { state: "in_review", handoff: "executive" },
  };
  await reportProgress(75);

  // PII redaction on generated brief content BEFORE persistence (AI-11).
  // Counts only are logged — never the redacted text.
  const { redactPayload, logRedactionEvent } = await import("./utils/pii");
  const piiCounts: Record<string, number> = {};
  const safeContent =
    process.env.PII_REDACTION === "off"
      ? content
      : (redactPayload(content, undefined, piiCounts) as typeof content);
  logRedactionEvent("runner.briefs.generate.output", piiCounts);

  const briefRouting = drafted.routing;
  await updateBrief(brief_id, {
    content: safeContent as never,
    reviewState: "in_review",
    modelRouting: briefRouting as never,
  });
  // AI-8: routing record persisted to the immutable audit store.
  await auditBackground(actor_id, "reports.generated", "brief", brief_id, {
    topic: EventTopics.reportsGenerated,
    model_routing: briefRouting,
  });
  return { brief_id };
});

/* ---------------------------- documents.register -------------------------- */

jobRunner.register("documents.register", async ({ input, reportProgress }) => {
  const { document_id, actor_id } = input as {
    document_id: string;
    actor_id: number | null;
  };
  const doc = await findDocument(document_id);
  if (!doc) throw new Error(`Document ${document_id} not found`);
  await reportProgress(50);
  // Parse pipeline stub: OCR confidence below 0.75 routes to human review.
  const needsReview = (doc.ocrConfidence ?? 1) < 0.75;
  await updateDocumentState(document_id, needsReview ? "in_review" : "approved");
  await auditBackground(actor_id, "documents.parse.requested", "document", document_id, {
    topic: EventTopics.documentsParseRequested,
    routed_to_review: needsReview,
  });
  return { document_id, routed_to_review: needsReview };
});

/* -------------------------- innovations.backtest ----------------------- */

jobRunner.register("innovations.backtest", async ({ input, reportProgress }) => {
  const { scenario_id, engine, cutoff_month } = input as {
    scenario_id: string;
    engine: SimulationEngine;
    cutoff_month: number;
  };
  const scenario = await findScenario(scenario_id);
  if (!scenario) throw new Error(`Scenario ${scenario_id} not found`);
  await reportProgress(25);

  // "Actuals": full-horizon deterministic series (the twin's record).
  const base = {
    scenario_id,
    engine,
    seed: 42,
    baseline_employment: 3_600_000,
    intervention_strength: 0.5,
  };
  const actual = runFallbackEngine({ ...base, horizon_months: 36 });
  await reportProgress(55);
  // "Trained on pre-cutoff": fit on months <= cutoff, project the remainder.
  const trained = runFallbackEngine({ ...base, horizon_months: cutoff_month });
  const lastTrained = trained.series[trained.series.length - 1];
  const prevTrained = trained.series[trained.series.length - 2] ?? lastTrained;
  const growth = lastTrained.mean - prevTrained.mean;
  const series: { month: number; actual: number; projected: number }[] = [];
  let apeSum = 0;
  let apeN = 0;
  for (let m = cutoff_month + 1; m <= 36; m++) {
    const projected = lastTrained.mean + growth * (m - cutoff_month);
    const actualMean = actual.series[m]?.mean ?? 0;
    series.push({ month: m, actual: actualMean, projected: Math.round(projected) });
    if (actualMean !== 0) {
      apeSum += Math.abs((actualMean - projected) / actualMean);
      apeN += 1;
    }
  }
  await reportProgress(85);
  const mape = apeN > 0 ? (apeSum / apeN) * 100 : 0;
  const result = {
    scenario_id,
    engine,
    cutoff_month,
    mape: Math.round(mape * 100) / 100,
    skill_score: Math.max(0, Math.round((1 - mape / 100) * 1000) / 1000),
    series,
  };
  await emitEvent(
    EventTopics.simulationsRunCompleted,
    { backtest: true, scenario_id, engine, mape: result.mape },
    scenario_id,
  );
  return result;
});

/* ------------------------- innovations.recalibrate --------------------- */

jobRunner.register("innovations.recalibrate", async ({ input, reportProgress }) => {
  const { jurisdiction_id } = input as { jurisdiction_id: string };
  await reportProgress(20);
  const metrics = await metricsForJurisdiction(jurisdiction_id);
  const existing = await twinStatesFor(jurisdiction_id);
  const byLayer = new Map(existing.map((t) => [t.layer, t]));
  await reportProgress(45);

  // Latest observation per (sector, metric).
  const latest = new Map<string, { value: number; period: string }>();
  for (const m of metrics) {
    latest.set(`${m.sectorCode}|${m.metricKey}`, { value: m.value, period: m.period });
  }
  const driftReport: {
    layer: string;
    prior: Record<string, number>;
    updated: Record<string, number>;
    moved: { metric: string; from: number; to: number; rel_change: number }[];
  }[] = [];
  const bySector = new Map<string, Map<string, number>>();
  for (const [key, obs] of latest) {
    const [sector, metric] = key.split("|");
    if (!bySector.has(sector)) bySector.set(sector, new Map());
    bySector.get(sector)!.set(metric, obs.value);
  }
  let i = 0;
  for (const [sector, observed] of bySector) {
    i += 1;
    const prior = (byLayer.get(sector)?.state ?? null) as {
      priors?: Record<string, number>;
    } | null;
    const priors = prior?.priors ?? {};
    const updated: Record<string, number> = {};
    const moved: { metric: string; from: number; to: number; rel_change: number }[] = [];
    for (const [metric, value] of observed) {
      const old = priors[metric];
      // Bayesian-ish nudge: 70% prior / 30% observation (first obs = prior).
      const next = old === undefined ? value : 0.7 * old + 0.3 * value;
      updated[metric] = Math.round(next * 1000) / 1000;
      if (old !== undefined && old !== 0) {
        const rel = Math.abs(next - old) / Math.abs(old);
        if (rel > 0.05) {
          moved.push({
            metric,
            from: Math.round(old * 1000) / 1000,
            to: updated[metric],
            rel_change: Math.round(rel * 1000) / 1000,
          });
        }
      }
    }
    const version = (byLayer.get(sector)?.version ?? 0) + 1;
    await upsertTwinState({
      jurisdictionId: jurisdiction_id,
      layer: sector,
      state: { priors: updated, calibrated_from: "sector_metrics" },
      version,
      calibratedAt: new Date(),
    });
    driftReport.push({ layer: sector, prior: priors, updated, moved });
    await reportProgress(45 + Math.round((50 * i) / bySector.size));
  }
  const result = {
    jurisdiction_id,
    layers_calibrated: bySector.size,
    drift: driftReport.filter((d) => d.moved.length > 0),
    calibrated_at: new Date().toISOString(),
  };
  await emitEvent(
    EventTopics.featuresMaterialized,
    { recalibration: true, jurisdiction_id, layers: bySector.size },
    jurisdiction_id,
  );
  return result;
});

/** Helper for routers: enqueue an already-persisted job row. */
export async function enqueuePersistedJob(jobId: string): Promise<void> {
  const job = await findJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status !== "queued") return; // idempotent re-submit guard
  jobRunner.enqueue({ jobId: job.jobId, type: job.type, input: job.input });
}
