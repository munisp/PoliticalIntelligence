import { z } from "zod";

/**
 * I1 — Policy Radar contracts (docs/INNOVATIONS.md §I1).
 *
 * The impact rubric is fully deterministic:
 *   impactScore = sectorWeight × instrumentWeight × amountFactor
 * scaled to [0,100] and rounded to 1 decimal — identical inputs always
 * produce identical scores, so weekly scans are idempotent (keyed on
 * alertId = "alert:<sourceEntity>:<sourceRef>").
 */

export const POLICY_ALERT_SOURCE_ENTITIES = ["bill", "regulation", "budget"] as const;
export const policyAlertSourceEntitySchema = z.enum(POLICY_ALERT_SOURCE_ENTITIES);
export type PolicyAlertSourceEntity = z.infer<typeof policyAlertSourceEntitySchema>;

export const matchedStakeholderSchema = z.object({
  stakeholderId: z.string(),
  name: z.string(),
  kind: z.string(),
});
export type MatchedStakeholder = z.infer<typeof matchedStakeholderSchema>;

export const policyAlertSchema = z.object({
  alertId: z.string(),
  jurisdictionId: z.string().nullable(),
  sector: z.string(),
  sourceEntity: policyAlertSourceEntitySchema,
  sourceRef: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  /** Rubric score in [0,100]. */
  impactScore: z.number().min(0).max(100),
  matchedStakeholders: z.array(matchedStakeholderSchema),
  createdAt: z.union([z.string(), z.date()]),
  origin: z.enum(["live", "derived", "seed"]),
});
export type PolicyAlertView = z.infer<typeof policyAlertSchema>;

export const radarAlertsInput = z.object({
  sector: z.string().max(64).optional(),
  jurisdiction_id: z.string().max(64).optional(),
  /** ISO date/datetime — only alerts created on/after this instant. */
  since: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type RadarAlertsInput = z.infer<typeof radarAlertsInput>;

export const radarAlertsOutput = z.object({
  alerts: z.array(policyAlertSchema),
});
export type RadarAlertsOutput = z.infer<typeof radarAlertsOutput>;

export const radarScanInput = z.object({
  /** Look-back window in days (default 7 — the weekly digest). */
  days: z.number().int().min(1).max(90).default(7),
  jurisdiction_id: z.string().max(64).optional(),
});
export type RadarScanInput = z.infer<typeof radarScanInput>;

export const radarScanOutput = z.object({
  scanned: z.number().int().nonnegative(),
  inserted: z.number().int().nonnegative(),
  alerts: z.array(policyAlertSchema),
});
export type RadarScanOutput = z.infer<typeof radarScanOutput>;

/* ------------------------------------------------------------------ */
/* Deterministic impact rubric                                         */
/* ------------------------------------------------------------------ */

/**
 * Sector keyword weights (regulatory salience of the sector for Nigeria
 * policy work): sector keyword hits in title/summary pick the max weight.
 */
export const SECTOR_KEYWORDS: Record<string, { weight: number; keywords: string[] }> = {
  energy: { weight: 1.0, keywords: ["energy", "power", "electricity", "solar", "renewable", "petroleum", "gas"] },
  finance: { weight: 0.95, keywords: ["bank", "fintech", "payment", "tax", "fiscal", "customs", "revenue", "cbn"] },
  infrastructure: { weight: 0.9, keywords: ["road", "highway", "rail", "port", "works", "construction", "transport"] },
  health: { weight: 0.85, keywords: ["health", "hospital", "medical", "pharma"] },
  agriculture: { weight: 0.8, keywords: ["agric", "food", "farm", "crop", "livestock"] },
  education: { weight: 0.75, keywords: ["education", "school", "university", "student"] },
  digital: { weight: 0.7, keywords: ["digital", "data", "ict", "telecom", "broadband", "cyber"] },
  trade: { weight: 0.65, keywords: ["trade", "commerce", "industry", "msme", "enterprise", "investment"] },
  general: { weight: 0.5, keywords: [] },
};

/** Instrument-type weight: regulations bind immediately, budgets appropriate. */
export const INSTRUMENT_WEIGHTS: Record<PolicyAlertSourceEntity, number> = {
  regulation: 1.0,
  bill: 0.8,
  budget: 0.7,
};

/**
 * Amount magnitude factor from an appropriation (₦): log-scaled
 * 1.0 at ₦0–1B rising to 2.0 at ≥ ₦1T; documents without amounts get 1.0.
 */
export function amountFactor(appropriatedNgn: number | null | undefined): number {
  if (!appropriatedNgn || appropriatedNgn <= 0) return 1.0;
  const log10 = Math.log10(appropriatedNgn);
  // ₦1B (9) → 1.0 ; ₦1T (12) → 2.0 ; clamped.
  const f = 1 + (log10 - 9) / 3;
  return Math.min(2, Math.max(1, Math.round(f * 1000) / 1000));
}

/** Deterministic impact score in [0,100] (1 decimal). */
export function impactScore(opts: {
  text: string;
  sourceEntity: PolicyAlertSourceEntity;
  appropriatedNgn?: number | null;
}): { score: number; sector: string } {
  const lc = opts.text.toLowerCase();
  let sector = "general";
  let sectorWeight = SECTOR_KEYWORDS.general.weight;
  for (const [name, cfg] of Object.entries(SECTOR_KEYWORDS)) {
    if (name === "general") continue;
    if (cfg.keywords.some((k) => lc.includes(k)) && cfg.weight > sectorWeight) {
      sector = name;
      sectorWeight = cfg.weight;
    }
  }
  const raw =
    sectorWeight *
    INSTRUMENT_WEIGHTS[opts.sourceEntity] *
    amountFactor(opts.appropriatedNgn);
  // raw max = 1.0 * 1.0 * 2.0 → scale ×50 into [0,100].
  const score = Math.round(Math.min(100, Math.max(0, raw * 50)) * 10) / 10;
  return { score, sector };
}
