import { z } from "zod";

/** I10 — Field verification loop contracts. */

export const FIELD_ENTITY_TYPES = ["milestone", "project", "metric"] as const;
export const FIELD_VERDICTS = ["confirmed", "disputed", "needs_review"] as const;

export const FieldVerifyInput = z.object({
  entity_type: z.enum(FIELD_ENTITY_TYPES),
  entity_ref: z.string().min(1).max(255),
  gps_lat: z.number().min(-90).max(90),
  gps_lng: z.number().min(-180).max(180),
  photo_uri: z.string().max(512).optional(),
  verdict: z.enum(FIELD_VERDICTS),
  notes: z.string().max(4000).optional(),
});

export const FieldListInput = z.object({
  entity_type: z.enum(FIELD_ENTITY_TYPES),
  entity_ref: z.string().min(1).max(255),
  limit: z.number().int().min(1).max(200).default(50),
});

/** ≥2 confirmed verifications upgrade an entity to field_verified. */
export const VERIFICATION_THRESHOLD = 2;

export type VerificationStatus = "field_verified" | "unverified";

export function verificationStatusFor(confirmedCount: number): VerificationStatus {
  return confirmedCount >= VERIFICATION_THRESHOLD
    ? "field_verified"
    : "unverified";
}
