/**
 * Shared types + helpers for the Executive Brief Generator (briefs.md).
 * The backend stores brief `content` as JSON: {sections, citations_rail, approval}
 * and `model_routing` as {tier, model, fallback}.
 */

export interface BriefSection {
  heading: string;
  body: string;
}

export interface BriefCitation {
  evidence_source_id: string;
  citation: string;
}

export interface BriefContent {
  title?: string;
  template?: string;
  sections: BriefSection[];
  citations_rail: BriefCitation[];
  approval?: { state?: string; handoff?: string };
}

export interface ModelRouting {
  tier?: string;
  model?: string;
  fallback?: boolean;
}

/** Minimal row shape used across the briefs UI (matches db briefs table). */
export interface BriefRow {
  briefId: string;
  jurisdictionId: string;
  template: string;
  title: string;
  reviewState: string;
  content: unknown;
  modelRouting: unknown;
  requestId: string | null;
  createdBy: number | null;
  approvedBy: number | null;
  signedOffAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  approval_history?: ApprovalEvent[];
}

export interface ApprovalEvent {
  eventId?: number | string;
  fromState?: string | null;
  from_state?: string | null;
  toState?: string;
  to_state?: string;
  actorId?: number | null;
  actor_id?: number | null;
  comment: string | null;
  createdAt?: Date | string;
  created_at?: Date | string;
}

/** Type-guard parse of the JSON content column. */
export function parseBriefContent(raw: unknown): BriefContent | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (!Array.isArray(c.sections)) return null;
  return {
    title: typeof c.title === "string" ? c.title : undefined,
    template: typeof c.template === "string" ? c.template : undefined,
    sections: (c.sections as Record<string, unknown>[])
      .filter((s) => s && typeof s.heading === "string")
      .map((s) => ({
        heading: String(s.heading),
        body: typeof s.body === "string" ? s.body : "",
      })),
    citations_rail: Array.isArray(c.citations_rail)
      ? (c.citations_rail as Record<string, unknown>[]).map((r) => ({
          evidence_source_id: String(r.evidence_source_id ?? ""),
          citation: String(r.citation ?? ""),
        }))
      : [],
    approval:
      c.approval && typeof c.approval === "object"
        ? (c.approval as { state?: string; handoff?: string })
        : undefined,
  };
}

export function parseModelRouting(raw: unknown): ModelRouting | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    tier: typeof r.tier === "string" ? r.tier : undefined,
    model: typeof r.model === "string" ? r.model : undefined,
    fallback: typeof r.fallback === "boolean" ? r.fallback : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Templates (UI picker) → API enum                                     */
/* ------------------------------------------------------------------ */

export type TemplateId = "decision" | "situation" | "progress" | "options";

export interface TemplateDef {
  id: TemplateId;
  /** briefs.generate template enum value. */
  apiTemplate: "executive_memo" | "sector_brief" | "scenario_summary";
  name: string;
  tagline: string;
  /** Section skeleton shown in the composer (eyebrow labels). */
  sections: { eyebrow: string; placeholder: string }[];
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: "decision",
    apiTemplate: "executive_memo",
    name: "Decision brief",
    tagline: "Recommendation + options + ask",
    sections: [
      { eyebrow: "Recommendation", placeholder: "The recommended course of action, in one paragraph…" },
      { eyebrow: "Options considered", placeholder: "Options ranked by opportunity score, jobs and legal readiness…" },
      { eyebrow: "The ask", placeholder: "What the executive is asked to approve, and by when…" },
    ],
  },
  {
    id: "situation",
    apiTemplate: "sector_brief",
    name: "Situation brief",
    tagline: "Status + risks",
    sections: [
      { eyebrow: "Situation", placeholder: "Current status of the sector or programme…" },
      { eyebrow: "Key risks", placeholder: "Risks with likelihood and mitigation…" },
    ],
  },
  {
    id: "progress",
    apiTemplate: "sector_brief",
    name: "Progress brief",
    tagline: "KPI vs target",
    sections: [
      { eyebrow: "Headline KPIs", placeholder: "KPI performance against the 250,000-jobs target…" },
      { eyebrow: "Trajectory", placeholder: "Progress trajectory and variance explanation…" },
    ],
  },
  {
    id: "options",
    apiTemplate: "scenario_summary",
    name: "Options memo",
    tagline: "2–4 options compared",
    sections: [
      { eyebrow: "Option comparison", placeholder: "Compare 2–4 options across jobs, budget, readiness…" },
      { eyebrow: "Trade-offs", placeholder: "Principal trade-offs and sensitivities…" },
    ],
  },
];

export function templateById(id: TemplateId): TemplateDef {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}

/** Row type chip label derived from the stored API template value. */
export function typeChipLabel(apiTemplate: string): string {
  switch (apiTemplate) {
    case "executive_memo":
      return "Decision";
    case "sector_brief":
      return "Situation";
    case "scenario_summary":
      return "Options";
    default:
      return "Progress";
  }
}

/* ------------------------------------------------------------------ */
/* Misc formatting                                                     */
/* ------------------------------------------------------------------ */

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatDate(date)} · ${date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/** Author initials from a user id (seed data carries numeric ids). */
export function authorInitials(createdBy: number | null | undefined): string {
  if (createdBy == null) return "—";
  const names = ["AM", "BO", "CI", "DE", "FA", "GU", "HA", "IB"];
  return names[Math.abs(Number(createdBy)) % names.length];
}

/** Deterministic 32-bit hash for seeded pseudo-random UI derivations. */
export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seeded PRNG (mulberry32) — stable across renders/sessions. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
