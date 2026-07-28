import { z } from "zod";
import { nanoid } from "nanoid";
import {
  CITATION_RELATIONS,
  REVIEW_STATES,
  type ReviewState,
  type SimulationResultSummary,
} from "@contracts/entities";
import {
  DRAFT_SECTIONS,
  EvidenceBaseSchema,
  RiaAnnexSchema,
  type DraftedClause,
} from "@contracts/drafting";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { envelope, apiError, audit } from "./utils/envelope";
import { requireRole, assertJurisdictionAccess, assertJurisdictionRead, resolveReadScope } from "./utils/rbac";
import { assertDatasetRead } from "./utils/datasets";
import {
  approvalEventsFor,
  citationTrace,
  clauseReviewQueue,
  clausesForLaw,
  findClause,
  findLaw,
  graphQuery,
  insertApprovalEvent,
  listLaws,
  updateClauseReviewState,
  insertDraftLaw,
  updateLawRiaAnnex,
  upsertGeneratedClause,
  updateClauseText,
} from "./queries/legislation";
import { findDocument } from "./queries/admin";
import { findSimulationRun, findScenario } from "./queries/scenarios";
import { evidenceByIds, findOpportunity } from "./queries/opportunities";
import {
  DraftingContractError,
  generateDraftClauses,
} from "./bridges/drafting";
import { renderDraftAkn } from "./queries/documents";
import { buildDraftAkn } from "./lib/akn";
import { computePolicyDiff } from "./lib/policy-diff";
import {
  CLAUSE_REVIEW_CONFIDENCE,
  type ClauseArtifact,
} from "@contracts/documents";
import {
  DocumentsServiceUnreachable,
  ensureReviewTask,
  fetchClausesArtifact,
  upsertClause,
  upsertLaw,
} from "./queries/documents";

/** Valid review-state transitions (spec §27). */
const TRANSITIONS: Record<ReviewState, ReviewState[]> = {
  draft: ["in_review"],
  in_review: ["approved", "returned"],
  approved: ["signed_off", "returned"],
  signed_off: [],
  returned: ["draft", "in_review"],
};

export const legislationRouter = createRouter({
  // ABAC-scoped read (SR-10/SEC-3): actors see laws in their assigned
  // jurisdictions only; executive/platform_admin see all.
  laws: publicQuery
    .input(
      z.object({
        jurisdiction_id: z.string().optional(),
        category: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const scope = await resolveReadScope(ctx, input.jurisdiction_id);
      return envelope(
        await listLaws({
          jurisdictionId: scope.jurisdictionId,
          jurisdictionIds: scope.jurisdictionIds,
          category: input.category,
          cursor: input.cursor,
          limit: input.limit,
        }),
        ctx,
      );
    }),

  law: publicQuery
    .input(z.object({ law_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const law = await findLaw(input.law_id);
      if (!law)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "LAW_NOT_FOUND",
          message: `Law ${input.law_id} not found`,
        });
      await assertJurisdictionRead(ctx, law.jurisdictionId);
      const clauseCount = (await clausesForLaw(input.law_id)).length;
      return envelope({ ...law, clause_count: clauseCount }, ctx);
    }),

  clauses: publicQuery
    .input(z.object({ law_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const law = await findLaw(input.law_id);
      if (law) await assertJurisdictionRead(ctx, law.jurisdictionId);
      // SEC-3: dataset-level ABAC — a restricted instrument's clauses are
      // forbidden to actors outside the policy's roles/jurisdiction.
      await assertDatasetRead(ctx, {
        entityType: "clause",
        datasetId: input.law_id,
        jurisdictionId: law?.jurisdictionId ?? null,
      });
      return envelope(await clausesForLaw(input.law_id), ctx);
    }),

  clause: publicQuery
    .input(z.object({ clause_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const clause = await findClause(input.clause_id);
      if (!clause)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "CLAUSE_NOT_FOUND",
          message: `Clause ${input.clause_id} not found`,
        });
      const clauseLaw = await findLaw(clause.lawId);
      if (clauseLaw)
        await assertJurisdictionRead(ctx, clauseLaw.jurisdictionId);
      const [trace, approvals] = await Promise.all([
        citationTrace(input.clause_id),
        approvalEventsFor("clause", input.clause_id),
      ]);
      return envelope({ ...clause, citation_trace: trace, approval_history: approvals }, ctx);
    }),

  graphQuery: publicQuery
    .input(
      z
        .object({
          seed_clause_id: z.string().optional(),
          seed_law_id: z.string().optional(),
          relation: z.enum(CITATION_RELATIONS).optional(),
          depth: z.number().int().min(1).max(5).default(2),
        })
        .refine((v) => v.seed_clause_id || v.seed_law_id, {
          message: "seed_clause_id or seed_law_id is required",
        }),
    )
    .query(async ({ ctx, input }) => {
      // ABAC: assert read access on the seed law's jurisdiction.
      const seedLawId =
        input.seed_law_id ??
        (input.seed_clause_id
          ? (await findClause(input.seed_clause_id))?.lawId
          : undefined);
      if (seedLawId) {
        const law = await findLaw(seedLawId);
        if (law) await assertJurisdictionRead(ctx, law.jurisdictionId);
      }
      return envelope(
        await graphQuery({
          seedClauseId: input.seed_clause_id,
          seedLawId: input.seed_law_id,
          relation: input.relation,
          depth: input.depth,
        }),
        ctx,
      );
    }),

  /**
   * Clause-level comparison of two laws (SR-8). Reuses the deterministic
   * clause-alignment engine from the innovations policyDiff surface
   * (api/lib/policy-diff.ts) — identical inputs yield identical outputs.
   */
  compare: publicQuery
    .input(
      z.object({
        law_id_a: z.string().min(1),
        law_id_b: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { result, missingLawId } = await computePolicyDiff(
        input.law_id_a,
        input.law_id_b,
      );
      if (!result)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "LAW_NOT_FOUND",
          message: `Law ${missingLawId} not found`,
        });
      return envelope(result, ctx);
    }),

  reviewQueue: authedQuery
    .input(
      z.object({
        review_state: z.enum(REVIEW_STATES).optional(),
        low_confidence_only: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      requireRole(ctx, ["legal_analyst"]);
      return envelope(
        await clauseReviewQueue({
          reviewState: input.review_state,
          lowConfidenceOnly: input.low_confidence_only,
          limit: input.limit,
        }),
        ctx,
      );
    }),

  /** Legal-analyst review transition; emits approval_events + audit. */
  updateReviewState: authedQuery
    .input(
      z.object({
        clause_id: z.string().min(1),
        to_state: z.enum(REVIEW_STATES),
        comment: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["legal_analyst"]);
      const clause = await findClause(input.clause_id);
      if (!clause)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "CLAUSE_NOT_FOUND",
          message: `Clause ${input.clause_id} not found`,
        });
      const law = await findLaw(clause.lawId);
      if (law) {
        // ABAC: legal review is jurisdiction-scoped like other domains.
        await assertJurisdictionAccess(ctx, law.jurisdictionId, "write");
      }
      const from = clause.reviewState;
      const allowed = TRANSITIONS[from] ?? [];
      if (!allowed.includes(input.to_state))
        throw apiError(ctx, {
          http: "CONFLICT",
          code: "INVALID_TRANSITION",
          message: `Cannot move clause from ${from} to ${input.to_state}`,
          details: { from, allowed },
        });
      await updateClauseReviewState(input.clause_id, input.to_state);
      await insertApprovalEvent({
        entityType: "clause",
        entityId: input.clause_id,
        fromState: from,
        toState: input.to_state,
        actorId: ctx.user.id,
        comment: input.comment ?? null,
      });
      audit(ctx, "legislation.review_state.changed", {
        type: "clause",
        id: input.clause_id,
        scopes: ["legislation:review"],
        payload: { from_state: from, to_state: input.to_state },
      });
      const updated = await findClause(input.clause_id);
      return envelope(updated, ctx);
    }),

  /**
   * Import a processed law document (spec §18.6): idempotently creates /
   * updates laws + clauses rows from the documents service's clauses JSON.
   * Clauses below the BR-4 confidence floor are routed to review tasks.
   */
  importFromDocument: authedQuery
    .input(z.object({ document_id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["legal_analyst", "data_steward"]);
      const doc = await findDocument(input.document_id);
      if (!doc)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "DOCUMENT_NOT_FOUND",
          message: `Document ${input.document_id} not found`,
        });
      if (doc.docType !== "law")
        throw apiError(ctx, {
          http: "BAD_REQUEST",
          code: "NOT_A_LAW_DOCUMENT",
          message: `Document ${input.document_id} has doc_type '${doc.docType}', expected 'law'`,
        });
      await assertJurisdictionAccess(ctx, doc.jurisdictionId, "write");

      let clauses: ClauseArtifact[];
      try {
        clauses = await fetchClausesArtifact(input.document_id);
      } catch (err) {
        if (err instanceof DocumentsServiceUnreachable)
          throw apiError(ctx, {
            http: "INTERNAL_SERVER_ERROR",
            code: "DOCUMENTS_SERVICE_UNREACHABLE",
            message: "documents service unreachable",
            retryable: true,
          });
        throw err;
      }

      const lawId = `law:${doc.jurisdictionId.replace(/^jur:/, "")}:${input.document_id.replace(/^doc:[^:]+:/, "")}`;
      const yearMatch = doc.title.match(/\b(19|20)\d{2}\b/);
      await upsertLaw({
        lawId,
        title: doc.title,
        jurisdictionId: doc.jurisdictionId,
        category: doc.docType,
        status: "in_force",
        year: yearMatch ? Number(yearMatch[0]) : null,
        sourceUri: doc.sourceUri,
      });

      let imported = 0;
      let reviewTaskCount = 0;
      for (const clause of clauses) {
        if (!clause.text.trim()) continue;
        const clauseId = `cls:${lawId}:${clause.section_path}`.slice(0, 96);
        await upsertClause({
          clauseId,
          lawId,
          sectionPath: clause.section_path,
          text: clause.text,
          language: doc.language,
          confidence: clause.confidence,
          reviewState: "draft",
          obligations: clause.obligations as never,
        });
        imported += 1;
        if (clause.confidence < CLAUSE_REVIEW_CONFIDENCE) {
          await ensureReviewTask({
            type: "legal_extract",
            entityRef: clauseId,
            assigneeRole: "legal_analyst",
            payload: {
              document_id: input.document_id,
              section_path: clause.section_path,
              confidence: clause.confidence,
              threshold: CLAUSE_REVIEW_CONFIDENCE,
            },
          });
          reviewTaskCount += 1;
        }
      }
      audit(ctx, "legislation.imported_from_document", {
        type: "law",
        id: lawId,
        scopes: ["legislation:import"],
        payload: {
          document_id: input.document_id,
          clauses_imported: imported,
          review_tasks: reviewTaskCount,
        },
      });
      return envelope(
        {
          law_id: lawId,
          document_id: input.document_id,
          clauses_imported: imported,
          review_tasks_created: reviewTaskCount,
        },
        ctx,
      );
    }),

  /* ------------------------- G4: bill drafting ------------------------ */

  /**
   * Create a draft bill (status="draft") linked to its evidence base:
   * a simulation run, ranked opportunities and/or citation (evidence) ids.
   */
  createDraft: authedQuery
    .input(
      z.object({
        jurisdictionId: z.string().min(1),
        title: z.string().min(3).max(512),
        purpose: z.string().min(10).max(4000),
        evidenceBase: EvidenceBaseSchema,
        targetOutcomes: z.array(z.string().min(1).max(500)).max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["legal_analyst", "policy_analyst"]);
      await assertJurisdictionAccess(ctx, input.jurisdictionId, "write");
      // Validate linked evidence exists before persisting the draft.
      if (input.evidenceBase.simulation_run_id) {
        const run = await findSimulationRun(input.evidenceBase.simulation_run_id);
        if (!run)
          throw apiError(ctx, {
            http: "NOT_FOUND",
            code: "SIMULATION_RUN_NOT_FOUND",
            message: `Simulation run ${input.evidenceBase.simulation_run_id} not found`,
          });
      }
      for (const oppId of input.evidenceBase.opportunity_ids ?? []) {
        if (!(await findOpportunity(oppId)))
          throw apiError(ctx, {
            http: "NOT_FOUND",
            code: "OPPORTUNITY_NOT_FOUND",
            message: `Opportunity ${oppId} not found`,
          });
      }
      const lawId =
        `law:${input.jurisdictionId.replace(/^jur:/, "")}:draft:${nanoid(10)}`.slice(0, 64);
      const draft = {
        law_id: lawId,
        title: input.title,
        purpose: input.purpose,
        jurisdiction_id: input.jurisdictionId,
        target_outcomes: input.targetOutcomes,
        evidence_base: input.evidenceBase,
        status: "draft" as const,
      };
      await insertDraftLaw({
        lawId,
        title: input.title,
        jurisdictionId: input.jurisdictionId,
        category: "draft_bill",
        status: "draft",
        year: null,
        sourceUri: `drafting://${lawId}`,
        evidenceBase: {
          purpose: input.purpose,
          target_outcomes: input.targetOutcomes,
          ...input.evidenceBase,
        } as never,
      });
      audit(ctx, "legislation.draft.created", {
        type: "law",
        id: lawId,
        scopes: ["legislation:draft"],
        payload: {
          jurisdiction_id: input.jurisdictionId,
          evidence_base: input.evidenceBase,
          target_outcomes: input.targetOutcomes,
        },
      });
      return envelope(draft, ctx);
    }),

  /**
   * Generate (or regenerate) the clause set for a draft bill via the LLM
   * serving layer, grounded in the retrieval bundle + simulation results.
   * Offline tier is a deterministic structured synthesizer. Every generated
   * clause persists its evidence grounding.
   */
  generateClauses: authedQuery
    .input(
      z.object({
        law_id: z.string().min(1),
        /** Regenerate only these sections (default: all five). */
        only_sections: z.array(z.enum(DRAFT_SECTIONS)).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["legal_analyst", "policy_analyst"]);
      const law = await findLaw(input.law_id);
      if (!law)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "LAW_NOT_FOUND",
          message: `Law ${input.law_id} not found`,
        });
      if (law.status !== "draft")
        throw apiError(ctx, {
          http: "CONFLICT",
          code: "NOT_A_DRAFT",
          message: `Law ${input.law_id} has status '${law.status}', expected 'draft'`,
        });
      await assertJurisdictionAccess(ctx, law.jurisdictionId, "write");

      const eb = EvidenceBaseSchema.passthrough().parse(law.evidenceBase ?? {});
      const purpose =
        typeof (law.evidenceBase as { purpose?: unknown } | null)?.purpose === "string"
          ? ((law.evidenceBase as { purpose: string }).purpose)
          : law.title;
      const targetOutcomes = Array.isArray(
        (law.evidenceBase as { target_outcomes?: unknown } | null)?.target_outcomes,
      )
        ? ((law.evidenceBase as { target_outcomes: string[] }).target_outcomes)
        : [];

      // Retrieval bundle: citation ids + evidence linked to the opportunities.
      const opportunities = [];
      const evidenceIds = new Set<string>(eb.citation_ids ?? []);
      for (const oppId of eb.opportunity_ids ?? []) {
        const opp = await findOpportunity(oppId);
        if (opp) {
          opportunities.push({
            opportunity_id: opp.opportunityId,
            title: opp.title,
            summary: opp.summary,
          });
          for (const id of Array.isArray(opp.evidenceRefs) ? (opp.evidenceRefs as string[]) : [])
            evidenceIds.add(id);
        }
      }
      const evidenceRows = await evidenceByIds([...evidenceIds]);
      const evidence = evidenceRows.map((e) => ({
        evidence_source_id: e.evidenceSourceId,
        citation: e.citation,
        confidence: e.confidence,
        excerpt: e.contentExcerpt,
      }));

      // Simulation grounding.
      let simulation = null;
      if (eb.simulation_run_id) {
        const run = await findSimulationRun(eb.simulation_run_id);
        if (run) {
          simulation = {
            simulation_run_id: run.simulationRunId,
            engine: run.engine,
            seed: run.seed,
            reproducibility_hash: run.reproducibilityHash,
            result_summary: (run.resultSummary as SimulationResultSummary | null) ?? null,
          };
        }
      }

      let generated: Awaited<ReturnType<typeof generateDraftClauses>>;
      try {
        generated = await generateDraftClauses({
          law_id: law.lawId,
          title: law.title,
          purpose,
          jurisdiction_id: law.jurisdictionId,
          target_outcomes: targetOutcomes,
          evidence_base: eb,
          evidence,
          opportunities,
          simulation,
          only_sections: input.only_sections,
        });
      } catch (err) {
        if (err instanceof DraftingContractError) {
          audit(ctx, "legislation.draft.contract_validation_failed", {
            type: "law",
            id: law.lawId,
            scopes: ["legislation:draft"],
            payload: { errors: err.errors },
          });
          throw apiError(ctx, {
            http: "INTERNAL_SERVER_ERROR",
            code: "DRAFTING_CONTRACT_VIOLATION",
            message: "serving layer returned a clause set failing the drafting contract",
            details: { errors: err.errors },
            retryable: true,
          });
        }
        throw err;
      }
      const { clauseSet, bridge, routing } = generated;

      for (const clause of clauseSet.clauses) {
        const clauseId = `cls:${law.lawId}:gen:${clause.section}`.slice(0, 96);
        await upsertGeneratedClause({
          clauseId,
          lawId: law.lawId,
          sectionPath: clause.section_path,
          heading: clause.heading,
          text: clause.text,
          language: "en",
          confidence: 1.0,
          reviewState: "draft",
          grounding: clause.grounding as never,
          obligations: null,
        });
      }
      audit(ctx, "legislation.draft.clauses_generated", {
        type: "law",
        id: law.lawId,
        scopes: ["legislation:draft"],
        payload: {
          bridge,
          model_routing: routing,
          sections: clauseSet.clauses.map((c: DraftedClause) => c.section),
          clause_count: clauseSet.clauses.length,
        },
      });
      return envelope(
        { law_id: law.lawId, bridge, model_routing: routing, clauses: clauseSet.clauses },
        ctx,
      );
    }),

  /** Edit a generated clause's text (grounding + provenance preserved). */
  updateDraftClause: authedQuery
    .input(
      z.object({
        clause_id: z.string().min(1),
        text: z.string().min(1).max(20000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["legal_analyst", "policy_analyst"]);
      const clause = await findClause(input.clause_id);
      if (!clause)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "CLAUSE_NOT_FOUND",
          message: `Clause ${input.clause_id} not found`,
        });
      const law = await findLaw(clause.lawId);
      if (!law || law.status !== "draft")
        throw apiError(ctx, {
          http: "CONFLICT",
          code: "NOT_A_DRAFT",
          message: "Clause does not belong to a draft bill",
        });
      await assertJurisdictionAccess(ctx, law.jurisdictionId, "write");
      await updateClauseText(input.clause_id, input.text);
      audit(ctx, "legislation.draft.clause_edited", {
        type: "clause",
        id: input.clause_id,
        scopes: ["legislation:draft"],
        payload: { law_id: law.lawId },
      });
      return envelope(await findClause(input.clause_id), ctx);
    }),

  /**
   * Build + attach the Regulatory Impact Assessment annex from the draft's
   * linked simulation run: engine consensus, point estimates with 80%
   * uncertainty bands, assumptions, reproducibility hash and citations.
   */
  attachRIA: authedQuery
    .input(z.object({ law_id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["legal_analyst", "policy_analyst"]);
      const law = await findLaw(input.law_id);
      if (!law)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "LAW_NOT_FOUND",
          message: `Law ${input.law_id} not found`,
        });
      await assertJurisdictionAccess(ctx, law.jurisdictionId, "write");
      const eb = EvidenceBaseSchema.passthrough().parse(law.evidenceBase ?? {});
      if (!eb.simulation_run_id)
        throw apiError(ctx, {
          http: "BAD_REQUEST",
          code: "NO_SIMULATION_LINK",
          message: "Draft has no linked simulation run in its evidence base",
        });
      const run = await findSimulationRun(eb.simulation_run_id);
      if (!run || !run.resultSummary)
        throw apiError(ctx, {
          http: "CONFLICT",
          code: "RUN_WITHOUT_RESULTS",
          message: `Simulation run ${eb.simulation_run_id} has no persisted results`,
        });
      const scenario = await findScenario(run.scenarioId);
      const summary = run.resultSummary as SimulationResultSummary;
      const series = Array.isArray(summary.series) ? summary.series : [];
      const terminal = series[series.length - 1] ?? null;
      const horizon = terminal?.month ?? series.length;

      // Citations: draft evidence base (citation ids + opportunity refs).
      const evidenceIds = new Set<string>(eb.citation_ids ?? []);
      for (const oppId of eb.opportunity_ids ?? []) {
        const opp = await findOpportunity(oppId);
        if (opp && Array.isArray(opp.evidenceRefs))
          for (const id of opp.evidenceRefs as string[]) evidenceIds.add(id);
      }
      const evidenceRows = await evidenceByIds([...evidenceIds]);

      const ria = RiaAnnexSchema.parse({
        simulation_run_id: run.simulationRunId,
        scenario_id: run.scenarioId,
        engine: run.engine,
        consensus_summary:
          `The ${run.engine} engine projects "${summary.metric ?? "the target metric"}" ` +
          `over ${horizon} months for scenario ${run.scenarioId}` +
          (terminal
            ? `, reaching a mean of ${Math.round(terminal.mean).toLocaleString()} ${summary.unit ?? ""} ` +
              `with an 80% credible band of ${Math.round(terminal.lower).toLocaleString()}–` +
              `${Math.round(terminal.upper).toLocaleString()} at the horizon.`
            : ".") +
          ` The draft's instruments are sized to this consensus projection.`,
        point_estimates: terminal
          ? [
              {
                metric: summary.metric ?? "employment",
                unit: summary.unit ?? "jobs",
                value: Math.round(terminal.mean),
                lower: Math.round(terminal.lower),
                upper: Math.round(terminal.upper),
                horizon_months: terminal.month,
              },
            ]
          : [
              {
                metric: summary.metric ?? "employment",
                unit: summary.unit ?? "jobs",
                value: 0,
                lower: 0,
                upper: 0,
                horizon_months: Math.max(1, horizon),
              },
            ],
        assumptions: [
          `Engine ${run.engine} with seed ${run.seed} reproduces the projection (hash ${run.reproducibilityHash ?? "n/a"})`,
          scenario?.description
            ? `Scenario baseline: ${String(scenario.description).slice(0, 300)}`
            : "Baseline conditions follow the scenario definition",
          "Implementing agencies retain current capacity over the projection horizon",
          "Evidence sources cited in the annex refresh on cadence",
        ],
        reproducibility_hash: run.reproducibilityHash ?? "unavailable",
        citations: evidenceRows.slice(0, 10).map((e) => ({
          evidence_source_id: e.evidenceSourceId,
          citation: e.citation,
        })),
        generated_at: new Date().toISOString(),
      });
      await updateLawRiaAnnex(law.lawId, ria);
      audit(ctx, "legislation.draft.ria_attached", {
        type: "law",
        id: law.lawId,
        scopes: ["legislation:draft"],
        payload: {
          simulation_run_id: run.simulationRunId,
          engine: run.engine,
          reproducibility_hash: ria.reproducibility_hash,
          point_estimates: ria.point_estimates.length,
        },
      });
      return envelope(ria, ctx);
    }),

  /**
   * Export the draft bill as Akoma Ntoso 3.0 XML via the documents service
   * (RIA included as an annex). Falls back to the local deterministic AKN
   * builder when the service is unreachable.
   */
  exportDraftAkn: authedQuery
    .input(
      z.object({
        law_id: z.string().min(1),
        year: z.number().int().min(1900).max(2100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["legal_analyst", "policy_analyst"]);
      const law = await findLaw(input.law_id);
      if (!law)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "LAW_NOT_FOUND",
          message: `Law ${input.law_id} not found`,
        });
      await assertJurisdictionAccess(ctx, law.jurisdictionId, "write");
      const clauses = await clausesForLaw(law.lawId);
      if (clauses.length === 0)
        throw apiError(ctx, {
          http: "CONFLICT",
          code: "NO_CLAUSES",
          message: "Draft has no clauses — generate the clause set first",
        });
      const ria = (law.riaAnnex as never) ?? null;
      const payload = {
        title: law.title,
        clauses: clauses.map((c) => ({
          section_path: c.sectionPath,
          heading: c.heading,
          text: c.text,
          kind: "section",
        })),
        ria,
        country: "ng",
        doc_type: "bill",
        year: input.year ?? law.year ?? null,
        language: "eng",
      };
      let aknXml: string;
      let problems: string[] = [];
      let bridge: "service" | "local";
      try {
        const rendered = await renderDraftAkn(payload);
        aknXml = rendered.akn_xml;
        problems = rendered.problems;
        bridge = "service";
      } catch (err) {
        if (err instanceof DocumentsServiceUnreachable) {
          aknXml = buildDraftAkn({
            title: payload.title,
            clauses: payload.clauses,
            ria: ria as never,
            country: payload.country,
            docType: payload.doc_type,
            year: payload.year,
          });
          bridge = "local";
        } else {
          throw err;
        }
      }
      audit(ctx, "legislation.draft.akn_exported", {
        type: "law",
        id: law.lawId,
        scopes: ["legislation:draft"],
        payload: { bridge, clauses: clauses.length, has_ria: !!ria, problems },
      });
      return envelope(
        {
          law_id: law.lawId,
          akn_xml: aknXml,
          problems,
          bridge,
          filename: `${law.lawId.replace(/[^A-Za-z0-9]+/g, "-")}.akn.xml`,
        },
        ctx,
      );
    }),
});
