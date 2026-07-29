import { z } from "zod";
import {
  analyzeIdeaInput,
  analyzeIdeaOutput,
  engagementSchema,
  engagementsInput,
  engagementsOutput,
  getPathwayInput,
  logEngagementInput,
  pathwayChecklistInput,
  stakeholderMapInput,
  upcomingActionsOutput,
  type PathwayConstraint,
  type PathwayLicense,
  type PathwayStep,
  type StakeholderNode,
  type SupportingLawRef,
} from "@contracts/advocacy";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { envelope, apiError, audit } from "./utils/envelope";
import { requireRole, type AuthedCtx } from "./utils/rbac";
import {
  allEdges,
  allLawsLite,
  allStakeholders,
  engagementsFor,
  findPathway,
  insertEngagement,
  listPathways,
  stakeholdersByIds,
  upcomingEngagementsFor,
} from "./queries/advocacy";
import { cached } from "./utils/cache";
import type { RegulatoryPathway, Stakeholder } from "@db/schema";

/**
 * Policy Advocacy Pathway router (docs/ADVOCACY.md) — the "idea →
 * legislation" backend: regulatory pathways, the stakeholder map, and a
 * deterministic (rule_based) idea analyzer that the LLM serving tier can
 * later enrich (see ADVOCACY_LLM_HOOK below).
 */

type PathwayJson = {
  licenses: PathwayLicense[];
  constraints: PathwayConstraint[];
  supportingLawRefs: SupportingLawRef[];
  associationRefs: string[];
  steps: PathwayStep[];
};

function pathwayJson(row: RegulatoryPathway): PathwayJson {
  return {
    licenses: (row.licenses as PathwayLicense[] | null) ?? [],
    constraints: (row.constraints as PathwayConstraint[] | null) ?? [],
    supportingLawRefs: (row.supportingLawRefs as SupportingLawRef[] | null) ?? [],
    associationRefs: (row.associationRefs as string[] | null) ?? [],
    steps: (row.steps as PathwayStep[] | null) ?? [],
  };
}

function toNode(s: Stakeholder): StakeholderNode {
  return {
    stakeholderId: s.stakeholderId,
    kind: s.kind,
    name: s.name,
    title: s.title ?? null,
    org: s.org ?? null,
    state: s.state ?? null,
    chamber: s.chamber ?? null,
    sectorTags: (s.sectorTags as string[] | null) ?? [],
    bio: s.bio ?? null,
    influenceArea: s.influenceArea ?? null,
    lobbyAngle: s.lobbyAngle ?? null,
    contactNote: s.contactNote ?? null,
    asOf: s.asOf ?? null,
  };
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "are",
  "was", "were", "will", "would", "can", "could", "should", "a", "an",
  "of", "to", "in", "on", "by", "at", "as", "is", "it", "its", "be",
  "or", "we", "our", "their", "they", "them", "nigeria", "nigerian",
]);

function keywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * ADVOCACY_LLM_HOOK — the v1 analyzer is deterministic (`analysis_mode:
 * "rule_based"`). The LLM serving tier may later post-process the returned
 * matchedPathways/gaps/nextSteps to enrich rationale text; it MUST keep the
 * deterministic fitScore ordering contract and set `meta.analysis_mode`
 * accordingly (e.g. "rule_based+llm_rationale") so the UI can disclose the
 * analysis provenance honestly.
 */
async function analyzeIdeaRuleBased(input: z.infer<typeof analyzeIdeaInput>) {
  const [pathways, stakeholders, laws] = await Promise.all([
    listPathways(),
    allStakeholders(),
    allLawsLite(),
  ]);
  const ideaKw = keywords(`${input.title} ${input.description} ${input.sector}`);
  const sectorLc = input.sector.toLowerCase();

  const matched = pathways
    .map((p) => {
      const pJson = pathwayJson(p);
      const pKw = keywords(
        `${p.title} ${p.summary ?? ""} ${p.sector} ${pJson.supportingLawRefs
          .map((l) => `${l.title} ${l.relevance}`)
          .join(" ")}`,
      );
      const overlap = [...ideaKw].filter((w) => pKw.has(w));
      const sectorMatch =
        p.sector.toLowerCase() === sectorLc ||
        pKw.has(sectorLc) ||
        ideaKw.has(p.sector.toLowerCase());
      const jurisdictionMatch =
        input.jurisdictionScope === "both" ||
        p.jurisdictionScope === "both" ||
        p.jurisdictionScope === input.jurisdictionScope;
      let fit =
        Math.min(1, overlap.length / 6) * 0.55 +
        (sectorMatch ? 0.3 : 0) +
        (jurisdictionMatch ? 0.15 : 0);
      fit = Math.round(Math.min(1, fit) * 1000) / 1000;
      const rationale = [
        sectorMatch
          ? `Sector alignment with '${p.sector}'.`
          : `Adjacent sector ('${p.sector}' vs idea '${input.sector}').`,
        overlap.length > 0
          ? `Keyword overlap: ${overlap.slice(0, 8).join(", ")}.`
          : "No direct keyword overlap; matched on structure.",
        jurisdictionMatch
          ? `Jurisdiction scope compatible (${p.jurisdictionScope}).`
          : `Jurisdiction mismatch: pathway is ${p.jurisdictionScope}-scoped.`,
      ].join(" ");
      return {
        pathwayId: p.pathwayId,
        title: p.title,
        fitScore: fit,
        rationale,
        _j: pJson,
        _scope: p.jurisdictionScope,
      };
    })
    .filter((m) => m.fitScore > 0.1)
    .sort((a, b) => b.fitScore - a.fitScore);

  const top = matched.slice(0, 3);
  const best = top[0];

  // Supporting laws: union of matched-pathway refs + keyword matches in the
  // platform laws table (title/category keyword overlap).
  const lawRefs = new Map<string, SupportingLawRef>();
  for (const m of top) {
    for (const l of m._j.supportingLawRefs) lawRefs.set(l.ref, l);
  }
  for (const law of laws) {
    const lawKw = keywords(`${law.title} ${law.category ?? ""}`);
    const overlap = [...ideaKw].filter((w) => lawKw.has(w));
    if (overlap.length >= 2) {
      lawRefs.set(law.lawId, {
        ref: law.lawId,
        title: law.title,
        relevance: `Keyword match on: ${overlap.slice(0, 6).join(", ")}.`,
      });
    }
  }

  const licenses = best ? best._j.licenses : [];
  const constraints = best ? best._j.constraints : [];

  // Recommended stakeholders: sector-tag match + matched-pathway
  // associations, ranked by tag overlap.
  const recommended = stakeholders
    .map((s) => {
      const tags = (s.sectorTags as string[] | null) ?? [];
      const tagHits =
        tags.filter((t) => ideaKw.has(t.toLowerCase()) || t.toLowerCase() === sectorLc)
          .length + (tags.some((t) => t.toLowerCase().includes(sectorLc)) ? 1 : 0);
      const inPathway = top.some((m) => m._j.associationRefs.includes(s.stakeholderId));
      return { s, score: tagHits + (inPathway ? 2 : 0) };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ s }) => ({
      stakeholderId: s.stakeholderId,
      name: s.name,
      kind: s.kind,
      lobbyAngle: s.lobbyAngle ?? null,
    }));

  const gaps: string[] = [];
  if (!best) {
    gaps.push(
      "No seeded regulatory pathway fits this idea; consider commissioning a pathway scan with the policy team.",
    );
  } else {
    if (best._scope === "state" && input.jurisdictionScope === "federal") {
      gaps.push(
        "The closest pathway is state-scoped: adoption may require state-by-state instruments rather than a single federal act.",
      );
    }
    if (constraints.some((c) => c.severity === "high")) {
      gaps.push(
        "High-severity constraints present — resolve capital/consent/AML items before public launch.",
      );
    }
    if (top.length < 2) {
      gaps.push(
        "Limited pathway coverage in the knowledge base for this idea; validate against live regulator guidance.",
      );
    }
  }
  if (recommended.length === 0) {
    gaps.push("No stakeholders matched by sector tags; broaden the sector descriptor.");
  }

  const nextSteps = best
    ? best._j.steps.slice(0, 5).map((s) => `${s.step}. ${s.description} (owner: ${s.owner})`)
    : [
        "1. Define the regulatory hypothesis and target jurisdictions.",
        "2. Engage a policy_analyst to build a bespoke pathway entry.",
      ];

  return analyzeIdeaOutput.parse({
    matchedPathways: top.map(({ pathwayId, title, fitScore, rationale }) => ({
      pathwayId,
      title,
      fitScore,
      rationale,
    })),
    supportingLaws: [...lawRefs.values()].slice(0, 12),
    gaps,
    licenses,
    constraints,
    recommendedStakeholders: recommended,
    nextSteps,
    meta: { analysis_mode: "rule_based" },
  });
}

export const advocacyRouter = createRouter({
  /** Public read: pathway summaries. */
  listPathways: publicQuery.query(async ({ ctx }) => {
    const rows = await listPathways();
    return envelope(
      {
        pathways: rows.map((p) => ({
          pathwayId: p.pathwayId,
          sector: p.sector,
          title: p.title,
          summary: p.summary ?? null,
          jurisdictionScope: p.jurisdictionScope,
        })),
      },
      ctx,
    );
  }),

  /** Public read: full pathway detail. */
  getPathway: publicQuery
    .input(getPathwayInput)
    .query(async ({ ctx, input }) => {
      const row = await findPathway(input.pathwayId);
      if (!row) {
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "PATHWAY_NOT_FOUND",
          message: `Pathway ${input.pathwayId} not found`,
          retryable: false,
        });
      }
      const j = pathwayJson(row);
      return envelope(
        {
          pathway: {
            pathwayId: row.pathwayId,
            sector: row.sector,
            title: row.title,
            summary: row.summary ?? null,
            jurisdictionScope: row.jurisdictionScope,
            licenses: j.licenses,
            constraints: j.constraints,
            supportingLawRefs: j.supportingLawRefs,
            associationRefs: j.associationRefs,
            steps: j.steps,
            origin: row.origin,
          },
        },
        ctx,
      );
    }),

  /**
   * Stakeholder map. Filter by sector tag or pathway associations; matched
   * nodes are expanded with their 1-hop neighbours so the graph stays
   * connected for the UI.
   */
  stakeholderMap: publicQuery
    .input(stakeholderMapInput)
    .query(async ({ ctx, input }) => {
      // Hot read path (docs/REDIS.md): the full stakeholder/edge tables are
      // the expensive part of the map query; the pathway lookup itself stays
      // live so 404 semantics are unchanged. 5-minute read-through cache.
      const [stakeholders, edges] = await Promise.all([
        cached("advocacy:stakeholders:all", 300, () => allStakeholders()),
        cached("advocacy:edges:all", 300, () => allEdges()),
      ]);
      let seeds: Set<string>;
      if (input.pathwayId) {
        const row = await findPathway(input.pathwayId);
        if (!row) {
          throw apiError(ctx, {
            http: "NOT_FOUND",
            code: "PATHWAY_NOT_FOUND",
            message: `Pathway ${input.pathwayId} not found`,
            retryable: false,
          });
        }
        const j = pathwayJson(row);
        seeds = new Set(j.associationRefs);
        // Sector-tagged stakeholders also seed the map.
        const sectorLc = row.sector.toLowerCase();
        for (const s of stakeholders) {
          const tags = ((s.sectorTags as string[] | null) ?? []).map((t) =>
            t.toLowerCase(),
          );
          if (tags.includes(sectorLc)) seeds.add(s.stakeholderId);
        }
      } else if (input.sector) {
        const sectorLc = input.sector.toLowerCase();
        seeds = new Set(
          stakeholders
            .filter((s) =>
              ((s.sectorTags as string[] | null) ?? [])
                .map((t) => t.toLowerCase())
                .includes(sectorLc),
            )
            .map((s) => s.stakeholderId),
        );
      } else {
        seeds = new Set(stakeholders.map((s) => s.stakeholderId));
      }
      // 1-hop expansion.
      const nodeIds = new Set(seeds);
      for (const e of edges) {
        if (seeds.has(e.fromId) || seeds.has(e.toId)) {
          nodeIds.add(e.fromId);
          nodeIds.add(e.toId);
        }
      }
      const nodes = stakeholders
        .filter((s) => nodeIds.has(s.stakeholderId))
        .map(toNode);
      const nodeSet = new Set(nodes.map((n) => n.stakeholderId));
      const outEdges = edges
        .filter((e) => nodeSet.has(e.fromId) && nodeSet.has(e.toId))
        .map((e) => ({
          fromId: e.fromId,
          toId: e.toId,
          relation: e.relation,
          label: e.label ?? null,
        }));
      return envelope({ nodes, edges: outEdges }, ctx);
    }),

  /**
   * Authed (policy_analyst+): deterministic idea analysis against the
   * seeded pathway KB and the laws table. See ADVOCACY_LLM_HOOK above.
   */
  analyzeIdea: authedQuery
    .input(analyzeIdeaInput)
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx as AuthedCtx, [
        "policy_analyst",
        "legal_analyst",
        "executive",
        "data_steward",
      ]);
      const result = await analyzeIdeaRuleBased(input);
      audit(ctx, "advocacy.analyze_idea", {
        type: "advocacy_analysis",
        id: `idea:${input.sector}`,
        scopes: ["advocacy:analyze"],
        payload: {
          sector: input.sector,
          jurisdiction_scope: input.jurisdictionScope,
          matched: result.matchedPathways.map((m) => m.pathwayId),
          analysis_mode: result.meta.analysis_mode,
        },
      });
      return envelope(result, ctx);
    }),

  /** Public read: ordered checklist for a pathway. */
  pathwayChecklist: publicQuery
    .input(pathwayChecklistInput)
    .query(async ({ ctx, input }) => {
      const row = await findPathway(input.pathwayId);
      if (!row) {
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "PATHWAY_NOT_FOUND",
          message: `Pathway ${input.pathwayId} not found`,
          retryable: false,
        });
      }
      const j = pathwayJson(row);
      return envelope(
        { pathwayId: row.pathwayId, title: row.title, steps: j.steps },
        ctx,
      );
    }),

  /* ------------------------------------------------------------------ */
  /* I5 — Advocacy CRM (own-user scoped engagement log)                 */
  /* ------------------------------------------------------------------ */

  /**
   * Log a stakeholder engagement. Any authenticated platform role may log;
   * rows are own-user scoped (users see only their own log).
   */
  logEngagement: authedQuery
    .input(logEngagementInput)
    .mutation(async ({ ctx, input }) => {
      const stk = (await stakeholdersByIds([input.stakeholderId]))[0];
      if (!stk) {
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "STAKEHOLDER_NOT_FOUND",
          message: `Stakeholder ${input.stakeholderId} not found`,
          retryable: false,
        });
      }
      const created = await insertEngagement({
        stakeholderId: input.stakeholderId,
        userId: ctx.user.id,
        engagedAt: input.engagedAt ? new Date(input.engagedAt) : new Date(),
        channel: input.channel,
        outcome: input.outcome ?? null,
        commitments: input.commitments ?? null,
        nextAction: input.nextAction ?? null,
        nextActionDate: input.nextActionDate ?? null,
      });
      audit(ctx, "advocacy.engagement.logged", {
        type: "stakeholder",
        id: input.stakeholderId,
        scopes: ["advocacy:engage"],
        payload: { channel: input.channel, has_next_action: !!input.nextAction },
      });
      return envelope(
        { engagement: engagementSchema.parse(toEngagementView(created)) },
        ctx,
      );
    }),

  /** Engagement history for one stakeholder (own-user scoped). */
  engagements: authedQuery
    .input(engagementsInput)
    .query(async ({ ctx, input }) => {
      const rows = await engagementsFor(
        input.stakeholderId,
        ctx.user.id,
        input.limit,
      );
      return envelope(
        engagementsOutput.parse({
          engagements: rows.map(toEngagementView),
        }),
        ctx,
      );
    }),

  /**
   * Upcoming next actions across all of the actor's engagements, joined
   * with stakeholder names, soonest first (overdue items first).
   */
  upcomingActions: authedQuery.query(async ({ ctx }) => {
    const rows = (await upcomingEngagementsFor(ctx.user.id, 100)).filter(
      (r) => r.nextAction && r.nextActionDate,
    );
    const stks = await stakeholdersByIds([
      ...new Set(rows.map((r) => r.stakeholderId)),
    ]);
    const nameById = new Map(stks.map((s) => [s.stakeholderId, s.name]));
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const actions = rows
      .map((r) => {
        const d = r.nextActionDate ? new Date(`${r.nextActionDate}T00:00:00Z`) : null;
        const daysUntil = d
          ? Math.round((d.getTime() - today.getTime()) / (24 * 3600 * 1000))
          : null;
        return {
          ...toEngagementView(r),
          stakeholderName: nameById.get(r.stakeholderId) ?? null,
          daysUntil,
        };
      })
      .sort((a, b) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0));
    return envelope(upcomingActionsOutput.parse({ actions }), ctx);
  }),
});

/** DB row → contract view (I5). */
function toEngagementView(r: {
  id: number;
  stakeholderId: string;
  userId: number;
  engagedAt: Date;
  channel: string;
  outcome: string | null;
  commitments: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  createdAt: Date;
}) {
  return {
    id: r.id,
    stakeholderId: r.stakeholderId,
    userId: r.userId,
    engagedAt: r.engagedAt,
    channel: r.channel,
    outcome: r.outcome ?? null,
    commitments: r.commitments ?? null,
    nextAction: r.nextAction ?? null,
    nextActionDate: r.nextActionDate ?? null,
    createdAt: r.createdAt,
  };
}
