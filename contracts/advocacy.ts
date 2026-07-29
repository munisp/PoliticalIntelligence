import { z } from "zod";

/**
 * Policy Advocacy Pathway contracts (docs/ADVOCACY.md).
 * The frontend codes against these schemas verbatim; the tRPC router in
 * api/advocacy.ts validates inputs with them and shapes outputs to match.
 */

export const STAKEHOLDER_KINDS = [
  "individual",
  "committee",
  "ministry",
  "agency",
  "association",
  "state_body",
  "development_partner",
] as const;
export const StakeholderKindSchema = z.enum(STAKEHOLDER_KINDS);
export type StakeholderKind = z.infer<typeof StakeholderKindSchema>;

export const JurisdictionScopeSchema = z.enum(["federal", "state", "both"]);
export type JurisdictionScope = z.infer<typeof JurisdictionScopeSchema>;

/* ------------------------------------------------------------------ */
/* Stakeholders & graph                                                */
/* ------------------------------------------------------------------ */

export const stakeholderNodeSchema = z.object({
  stakeholderId: z.string(),
  kind: StakeholderKindSchema,
  name: z.string(),
  title: z.string().nullable(),
  org: z.string().nullable(),
  state: z.string().nullable(),
  chamber: z.string().nullable(),
  sectorTags: z.array(z.string()),
  bio: z.string().nullable(),
  influenceArea: z.string().nullable(),
  lobbyAngle: z.string().nullable(),
  contactNote: z.string().nullable(),
  asOf: z.string().nullable(),
});
export type StakeholderNode = z.infer<typeof stakeholderNodeSchema>;

export const stakeholderEdgeSchema = z.object({
  fromId: z.string(),
  toId: z.string(),
  relation: z.string(),
  label: z.string().nullable(),
});
export type StakeholderEdgeView = z.infer<typeof stakeholderEdgeSchema>;

export const stakeholderMapInput = z.object({
  sector: z.string().optional(),
  pathwayId: z.string().optional(),
});
export const stakeholderMapOutput = z.object({
  nodes: z.array(stakeholderNodeSchema),
  edges: z.array(stakeholderEdgeSchema),
});
export type StakeholderMap = z.infer<typeof stakeholderMapOutput>;

/* ------------------------------------------------------------------ */
/* Regulatory pathways                                                 */
/* ------------------------------------------------------------------ */

export const pathwayLicenseSchema = z.object({
  name: z.string(),
  issuer: z.string(),
  requirement: z.string(),
  typical_timeline: z.string(),
  cost_note: z.string(),
});
export type PathwayLicense = z.infer<typeof pathwayLicenseSchema>;

export const pathwayConstraintSchema = z.object({
  type: z.string(),
  description: z.string(),
  severity: z.enum(["low", "medium", "high"]),
});
export type PathwayConstraint = z.infer<typeof pathwayConstraintSchema>;

export const supportingLawRefSchema = z.object({
  /** laws.law_id when the law is in the platform KB, else a free-form ref. */
  ref: z.string(),
  title: z.string(),
  relevance: z.string(),
});
export type SupportingLawRef = z.infer<typeof supportingLawRefSchema>;

export const pathwayStepSchema = z.object({
  step: z.string(),
  owner: z.string(),
  description: z.string(),
  est_duration: z.string(),
});
export type PathwayStep = z.infer<typeof pathwayStepSchema>;

export const pathwaySummarySchema = z.object({
  pathwayId: z.string(),
  sector: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  jurisdictionScope: JurisdictionScopeSchema,
});
export type PathwaySummary = z.infer<typeof pathwaySummarySchema>;

export const pathwayDetailSchema = pathwaySummarySchema.extend({
  licenses: z.array(pathwayLicenseSchema),
  constraints: z.array(pathwayConstraintSchema),
  supportingLawRefs: z.array(supportingLawRefSchema),
  associationRefs: z.array(z.string()),
  steps: z.array(pathwayStepSchema),
  origin: z.enum(["live", "derived", "seed"]),
  asOf: z.string().nullable().optional(),
});
export type PathwayDetail = z.infer<typeof pathwayDetailSchema>;

export const getPathwayInput = z.object({ pathwayId: z.string().min(1) });

export const pathwayChecklistInput = z.object({ pathwayId: z.string().min(1) });
export const pathwayChecklistOutput = z.object({
  pathwayId: z.string(),
  title: z.string(),
  steps: z.array(pathwayStepSchema),
});
export type PathwayChecklist = z.infer<typeof pathwayChecklistOutput>;

/* ------------------------------------------------------------------ */
/* analyzeIdea (rule_based v1; LLM-enrichment hook documented)         */
/* ------------------------------------------------------------------ */

export const analyzeIdeaInput = z.object({
  title: z.string().min(3).max(255),
  description: z.string().min(10).max(8000),
  sector: z.string().min(1).max(64),
  jurisdictionScope: JurisdictionScopeSchema,
});
export type AnalyzeIdeaInput = z.infer<typeof analyzeIdeaInput>;

export const matchedPathwaySchema = z.object({
  pathwayId: z.string(),
  title: z.string(),
  /** Deterministic fit score in [0,1]. */
  fitScore: z.number().min(0).max(1),
  rationale: z.string(),
});

export const recommendedStakeholderSchema = z.object({
  stakeholderId: z.string(),
  name: z.string(),
  kind: StakeholderKindSchema,
  lobbyAngle: z.string().nullable(),
});

export const analyzeIdeaOutput = z.object({
  matchedPathways: z.array(matchedPathwaySchema),
  supportingLaws: z.array(supportingLawRefSchema),
  gaps: z.array(z.string()),
  licenses: z.array(pathwayLicenseSchema),
  constraints: z.array(pathwayConstraintSchema),
  recommendedStakeholders: z.array(recommendedStakeholderSchema),
  nextSteps: z.array(z.string()),
  meta: z.object({
    /** Honesty marker: v1 is deterministic; LLM tier may enrich later. */
    analysis_mode: z.literal("rule_based"),
  }),
});
export type AnalyzeIdeaOutput = z.infer<typeof analyzeIdeaOutput>;

/* ------------------------------------------------------------------ */
/* I5 — Advocacy CRM (stakeholder engagements)                         */
/* ------------------------------------------------------------------ */

export const ENGAGEMENT_CHANNELS = [
  "meeting",
  "call",
  "email",
  "roundtable",
  "site_visit",
  "other",
] as const;

export const logEngagementInput = z.object({
  stakeholderId: z.string().min(1).max(96),
  /** ISO datetime; defaults to now server-side. */
  engagedAt: z.string().optional(),
  channel: z.enum(ENGAGEMENT_CHANNELS),
  outcome: z.string().max(4000).optional(),
  commitments: z.string().max(4000).optional(),
  nextAction: z.string().max(1000).optional(),
  /** ISO date label (YYYY-MM-DD). */
  nextActionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type LogEngagementInput = z.infer<typeof logEngagementInput>;

export const engagementSchema = z.object({
  id: z.number().int().positive(),
  stakeholderId: z.string(),
  userId: z.number(),
  engagedAt: z.union([z.string(), z.date()]),
  channel: z.string(),
  outcome: z.string().nullable(),
  commitments: z.string().nullable(),
  nextAction: z.string().nullable(),
  nextActionDate: z.string().nullable(),
  createdAt: z.union([z.string(), z.date()]),
});
export type EngagementView = z.infer<typeof engagementSchema>;

export const engagementsInput = z.object({
  stakeholderId: z.string().min(1).max(96),
  limit: z.number().int().min(1).max(100).default(50),
});

export const engagementsOutput = z.object({
  engagements: z.array(engagementSchema),
});

export const upcomingActionsOutput = z.object({
  actions: z.array(
    engagementSchema.extend({
      stakeholderName: z.string().nullable(),
      /** Days until nextActionDate (negative = overdue). */
      daysUntil: z.number().nullable(),
    }),
  ),
});
