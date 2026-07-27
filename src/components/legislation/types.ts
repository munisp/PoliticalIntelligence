import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../api/router";
import type { ApprovalState } from "@/components/shared/ApprovalBadge";
import { unwrap, envelopeMeta, type EnvelopeMeta } from "@/lib/trpc-data";

/**
 * Envelope unwrap tolerant of the contracts-level Envelope type
 * (audit.actor_id is number | null server-side). Runtime behaviour is
 * identical — unwrap() already tolerates both shapes.
 */
export function unwrapData<T>(payload: unknown): T {
  return unwrap(payload as T);
}

export function payloadMeta(payload: unknown): EnvelopeMeta | null {
  return envelopeMeta(payload as null);
}

export type RouterOutputs = inferRouterOutputs<AppRouter>;

export type LawRow = RouterOutputs["legislation"]["laws"]["data"]["items"][number];
export type LawDetail = RouterOutputs["legislation"]["law"]["data"];
export type ClauseRow = RouterOutputs["legislation"]["clauses"]["data"][number];
export type ClauseDetail = RouterOutputs["legislation"]["clause"]["data"];
export type GraphData = RouterOutputs["legislation"]["graphQuery"]["data"];
export type ReviewQueueItem =
  RouterOutputs["legislation"]["reviewQueue"]["data"][number];
export type OcrReviewTask =
  RouterOutputs["documents"]["ocrReviewQueue"]["data"][number];

/** Valid review-state transitions (mirrors api/legislation.ts §27). */
export const REVIEW_TRANSITIONS: Record<string, string[]> = {
  draft: ["in_review"],
  in_review: ["approved", "returned"],
  approved: ["signed_off", "returned"],
  signed_off: [],
  returned: ["draft", "in_review"],
};

export function toApprovalState(dbState: string): ApprovalState {
  return dbState.replace(/_/g, "-") as ApprovalState;
}

export const TRANSITION_LABELS: Record<string, string> = {
  in_review: "Submit for review",
  approved: "Approve extraction",
  returned: "Request re-parse",
  signed_off: "Sign off",
  draft: "Return to draft",
};

/** Indexing health derived from a law's clause review states. */
export type IndexHealth = {
  status: "healthy" | "stale" | "queued";
  label: string;
};

export function indexHealth(states: string[]): IndexHealth {
  if (states.length === 0)
    return { status: "queued", label: "Metadata incomplete" };
  if (states.some((s) => s === "in_review" || s === "returned"))
    return { status: "stale", label: "OCR review pending" };
  if (states.some((s) => s === "draft"))
    return { status: "queued", label: "Metadata incomplete" };
  return { status: "healthy", label: "Indexed" };
}

/** Group label for the navigator tree, from jurisdiction id. */
export function corpusGroup(jurisdictionId: string): string {
  if (jurisdictionId.endsWith(":ng-kd")) return "Laws of Kaduna State";
  if (jurisdictionId.endsWith(":ng")) return "Federal Acts & Policies";
  return "Policy memos & executive orders";
}

/** Deterministic per-character confidence for the OCR QA heatmap. */
export function charConfidence(seed: string, index: number, base: number): number {
  let h = 2166136261;
  const s = `${seed}:${index}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const jitter = ((h >>> 0) % 1000) / 1000 - 0.5; // −0.5..0.5
  return Math.min(1, Math.max(0, base + jitter * 0.35));
}

export const RELATION_LABELS: Record<string, string> = {
  CITES: "cites",
  ENABLES: "enables",
  RESTRICTS: "restricts",
  APPLIES_TO: "applies to",
  ADMINISTERED_BY: "administered by",
};

/** Jurisdiction scope for the Nigeria pilot (Kaduna State). */
export const PILOT_JURISDICTION_ID = "jur:ng-kd";
