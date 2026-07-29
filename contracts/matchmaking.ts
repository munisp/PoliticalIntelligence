import { z } from "zod";

/**
 * I8 — Procurement match contracts.
 *
 * Deterministic readiness scoring: same inputs always yield the same score.
 * Components (each 0–1) blend into a 0–100 readinessScore:
 *   30% registration age (capped at 5 years),
 *   30% sector match (sector keyword appears in the supplier name/profile),
 *   20% LGA proximity (same jurisdiction / LGA as the opportunity),
 *   20% size class (SMEDAN-style entity-class proxy from CAC entity_type).
 */

export const SuppliersInput = z.object({
  opportunity_id: z.string().min(1).max(64),
  limit: z.number().int().min(1).max(50).default(10),
});

export const ReadinessInput = z.object({
  registration_id: z.string().min(1).max(96),
  /** Optional opportunity context; omitted = jurisdiction-only scoring. */
  opportunity_id: z.string().min(1).max(64).optional(),
});

/** Sector code → name keywords used for deterministic sector matching. */
export const SECTOR_KEYWORDS: Record<string, string[]> = {
  agro: ["agro", "farm", "grain", "food", "poultry", "fish", "crop", "livestock", "timber"],
  edu: ["school", "academy", "education", "learning", "book", "training", "college"],
  health: ["clinic", "hospital", "medical", "pharm", "health", "diagnostic", "lab"],
  proc: ["build", "constr", "civil", "engineer", "weld", "fabricat", "supply", "logistic", "hardware"],
  digital: ["tech", "digital", "software", "cyber", "data", "ict", "computer", "systems"],
  sme: ["trading", "store", "mart", "enterprise", "ventures", "textile", "fashion", "craft"],
  tourism: ["hotel", "tour", "hospitality", "resort", "travel", "lodge"],
  energy: ["solar", "energy", "power", "electric", "petrol", "gas"],
  transport: ["transport", "motors", "haulage", "logistic", "auto", "shipping"],
  water: ["water", "borehole", "plumb", "sanitation"],
};

/** SMEDAN-style size-class proxy from the CAC entity type. */
export function sizeClassScore(entityType: string | null | undefined): number {
  const t = (entityType ?? "").toLowerCase();
  if (t.includes("limited") || t.includes("ltd") || t.includes("plc")) return 1.0;
  if (t.includes("business_name") || t.includes("enterprise")) return 0.7;
  if (t.includes("cooperative") || t.includes("incorporated_trustee")) return 0.6;
  return 0.5;
}

/** Registration age score: linear, capped at 5 years. Unknown date → 0.3. */
export function registrationAgeScore(
  registeredAt: string | null | undefined,
  now: Date = new Date(),
): number {
  if (!registeredAt) return 0.3;
  const d = new Date(registeredAt);
  if (Number.isNaN(d.getTime())) return 0.3;
  const years = Math.max(0, (now.getTime() - d.getTime()) / (365.25 * 86400_000));
  return Math.min(1, years / 5);
}

/** Sector match: 1.0 when a sector keyword appears in the supplier name. */
export function sectorMatchScore(
  sectorCode: string | null | undefined,
  supplierName: string,
): number {
  if (!sectorCode) return 0.5;
  const keywords = SECTOR_KEYWORDS[sectorCode] ?? [];
  if (keywords.length === 0) return 0.5;
  const name = supplierName.toLowerCase();
  return keywords.some((k) => name.includes(k)) ? 1.0 : 0.3;
}

/** LGA proximity: same LGA 1.0, same jurisdiction 0.8, otherwise 0.2. */
export function proximityScore(
  oppJurisdiction: string | null | undefined,
  oppLga: string | null | undefined,
  supplierJurisdiction: string,
  supplierLga: string | null | undefined,
): number {
  if (oppJurisdiction && supplierJurisdiction !== oppJurisdiction) return 0.2;
  if (oppLga && supplierLga) {
    return supplierLga.toLowerCase() === oppLga.toLowerCase() ? 1.0 : 0.8;
  }
  return oppJurisdiction ? 0.8 : 0.5;
}

export interface ReadinessBreakdown {
  registration_age: number;
  sector_match: number;
  lga_proximity: number;
  size_class: number;
  readiness_score: number;
}

export function computeReadiness(parts: {
  registration_age: number;
  sector_match: number;
  lga_proximity: number;
  size_class: number;
}): ReadinessBreakdown {
  const score =
    0.3 * parts.registration_age +
    0.3 * parts.sector_match +
    0.2 * parts.lga_proximity +
    0.2 * parts.size_class;
  return { ...parts, readiness_score: Math.round(score * 1000) / 10 };
}
