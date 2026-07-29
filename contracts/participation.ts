import { z } from "zod";

/**
 * I6 — Public participation contracts.
 *
 * Deterministic theme aggregation: comments are bucketed into a fixed set of
 * policy themes via keyword matching (no ML — identical inputs always yield
 * identical theme tags and counts).
 */

export const COMMENT_SENTIMENTS = [
  "support",
  "oppose",
  "neutral",
  "suggestion",
] as const;
export const COMMENT_STATUSES = ["visible", "flagged", "hidden"] as const;

export const CommentInputSchema = z.object({
  law_id: z.string().min(1).max(64),
  body: z.string().min(3).max(4000),
  sentiment_hint: z.enum(COMMENT_SENTIMENTS).default("neutral"),
  /** Display name for anonymous commenters (ignored when authenticated). */
  pseudonym: z.string().min(2).max(128).optional(),
});
export type CommentInput = z.infer<typeof CommentInputSchema>;

export const ModerateInputSchema = z.object({
  comment_id: z.string().min(1).max(96),
  status: z.enum(COMMENT_STATUSES),
  reason: z.string().max(500).optional(),
});
export type ModerateInput = z.infer<typeof ModerateInputSchema>;

/* ------------------------------------------------------------------ */
/* Deterministic theme buckets                                          */
/* ------------------------------------------------------------------ */

/**
 * Fixed keyword buckets — ordered; the FIRST bucket whose keywords match
 * wins for primary tagging, but every matching bucket is recorded so the
 * aggregation stays a pure function of the comment text.
 */
export const THEME_BUCKETS = [
  { theme: "taxation_revenue", keywords: ["tax", "levy", "revenue", "fee", "duty", "vat"] },
  { theme: "business_msme", keywords: ["business", "msme", "sme", "startup", "enterprise", "company", "registration"] },
  { theme: "employment_jobs", keywords: ["job", "employment", "worker", "wage", "labour", "labor", "unemployment"] },
  { theme: "land_property", keywords: ["land", "property", "title", "c of o", "tenure", "allocation"] },
  { theme: "digital_data", keywords: ["data", "digital", "internet", "broadband", "privacy", "technology", "ict"] },
  { theme: "procurement_contracts", keywords: ["procurement", "contract", "tender", "bid", "supplier"] },
  { theme: "enforcement_compliance", keywords: ["enforce", "penalty", "fine", "compliance", "offence", "sanction", "inspector"] },
  { theme: "citizen_services", keywords: ["service", "clinic", "school", "hospital", "water", "transport", "citizen"] },
] as const;

export type ThemeName = (typeof THEME_BUCKETS)[number]["theme"];

/** Pure: assign theme tags to a comment body (lowercase keyword match). */
export function tagThemes(body: string): ThemeName[] {
  const text = body.toLowerCase();
  const tags: ThemeName[] = [];
  for (const bucket of THEME_BUCKETS) {
    if (bucket.keywords.some((k) => text.includes(k))) tags.push(bucket.theme);
  }
  return tags;
}

export interface ThemeSummaryBucket {
  theme: ThemeName | "other";
  total: number;
  support: number;
  oppose: number;
  neutral: number;
  suggestion: number;
}

/** Pure: aggregate tagged comments into per-theme counts + sentiment split. */
export function aggregateThemes(
  comments: { body: string; themeTags?: unknown; sentimentHint: string }[],
): ThemeSummaryBucket[] {
  const acc = new Map<string, ThemeSummaryBucket>();
  const bump = (theme: string, sentiment: string) => {
    let b = acc.get(theme);
    if (!b) {
      b = { theme: theme as ThemeSummaryBucket["theme"], total: 0, support: 0, oppose: 0, neutral: 0, suggestion: 0 };
      acc.set(theme, b);
    }
    b.total += 1;
    if (sentiment === "support") b.support += 1;
    else if (sentiment === "oppose") b.oppose += 1;
    else if (sentiment === "suggestion") b.suggestion += 1;
    else b.neutral += 1;
  };
  for (const c of comments) {
    const stored = Array.isArray(c.themeTags) ? (c.themeTags as string[]) : null;
    const tags = stored ?? tagThemes(c.body);
    if (tags.length === 0) bump("other", c.sentimentHint);
    else for (const t of tags) bump(t, c.sentimentHint);
  }
  // Deterministic ordering: by descending total, then theme name.
  return [...acc.values()].sort(
    (a, b) => b.total - a.total || a.theme.localeCompare(b.theme),
  );
}
