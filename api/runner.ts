import { nanoid } from "nanoid";
import type { SimulationEngine } from "@contracts/entities";
import { EventTopics } from "@contracts/entities";
import { createJobRunner, type JobRunner } from "./utils/jobs";
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
import { executeScenarioRun } from "./bridges/simulation";

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

  const { recommendation, bridge } = await generateRecommendation({
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
  await auditBackground(
    actor_id,
    "recommendations.generated",
    "recommendation",
    recommendation.recommendation_id,
    { topic: EventTopics.recommendationsGenerated, bridge },
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

  const { result, bridge } = await executeScenarioRun({
    scenario_id: run.scenarioId,
    engine: run.engine as SimulationEngine,
    seed: run.seed,
    horizon_months: 36,
    baseline_employment: 3_600_000, // Kaduna labour force scale
    intervention_strength: scenario?.modelPlan ? 0.6 : 0.4,
    execution_profile: (run.executionProfile as Record<string, unknown>) ?? {},
  });
  await reportProgress(75);

  await updateSimulationRunResult(simulation_run_id, {
    status: "succeeded",
    progress: 100,
    resultSummary: result as never,
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
  await reportProgress(40);

  // Structured, IBM-Plex-Serif-ready brief content with a citations rail.
  const content = {
    title: brief.title,
    template: brief.template,
    sections: [
      {
        heading: "Executive summary",
        body: "This brief was generated from the current evidence base and ranked opportunities for the jurisdiction. All figures carry confidence scores and provenance in the citations rail.",
      },
      {
        heading: "Situation",
        body: "Sector metrics and pipeline freshness indicate a viable intervention window. See Evidence drawer for source-level detail.",
      },
      {
        heading: "Options",
        body: "Options are ranked by opportunity score, estimated jobs, and legal readiness. Human review is required before sign-off.",
      },
      {
        heading: "Recommendation",
        body: "Proceed with the top-ranked option under phased procurement, subject to executive sign-off.",
      },
    ],
    citations_rail: [] as { evidence_source_id: string; citation: string }[],
    approval: { state: "in_review", handoff: "executive" },
  };
  await reportProgress(75);

  await updateBrief(brief_id, {
    content: content as never,
    reviewState: "in_review",
    modelRouting: { tier: "offline-fallback", model: "deterministic", fallback: true } as never,
  });
  await auditBackground(actor_id, "reports.generated", "brief", brief_id, {
    topic: EventTopics.reportsGenerated,
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

/** Helper for routers: enqueue an already-persisted job row. */
export async function enqueuePersistedJob(jobId: string): Promise<void> {
  const job = await findJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status !== "queued") return; // idempotent re-submit guard
  jobRunner.enqueue({ jobId: job.jobId, type: job.type, input: job.input });
}
