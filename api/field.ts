import { nanoid } from "nanoid";
import { FieldListInput, FieldVerifyInput } from "@contracts/field";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { envelope, audit } from "./utils/envelope";
import { requireRole } from "./utils/rbac";
import { insertVerification, verificationsFor } from "./queries/field";

/**
 * I10 — Field verification loop: field officers submit GPS-stamped verdicts
 * on milestones, projects and outcome metrics. Verified outcome series
 * periods surface `verification_status` on outcomes.getObservations
 * (see api/outcomes.ts).
 */
export const fieldRouter = createRouter({
  /** Submit a verification (field_officer / data_steward; audited). */
  verify: authedQuery
    .input(FieldVerifyInput)
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["field_officer", "data_steward"]);
      const verificationId = `fv:${nanoid(12)}`;
      const row = await insertVerification({
        verificationId,
        entityType: input.entity_type,
        entityRef: input.entity_ref,
        verifierId: ctx.user.id,
        gpsLat: input.gps_lat,
        gpsLng: input.gps_lng,
        photoUri: input.photo_uri ?? null,
        verdict: input.verdict,
        notes: input.notes ?? null,
      });
      audit(ctx, "field.verification.submitted", {
        type: "field_verification",
        id: verificationId,
        scopes: ["field:verify"],
        payload: {
          entity_type: input.entity_type,
          entity_ref: input.entity_ref,
          verdict: input.verdict,
        },
      });
      return envelope(row, ctx);
    }),

  /** Verifications for one entity (public read). */
  list: publicQuery
    .input(FieldListInput)
    .query(async ({ ctx, input }) => {
      const rows = await verificationsFor(
        input.entity_type,
        input.entity_ref,
        input.limit,
      );
      return envelope(
        rows.map((r) => ({
          verification_id: r.verificationId,
          entity_type: r.entityType,
          entity_ref: r.entityRef,
          gps_lat: r.gpsLat,
          gps_lng: r.gpsLng,
          photo_uri: r.photoUri,
          verdict: r.verdict,
          notes: r.notes,
          created_at: r.createdAt,
        })),
        ctx,
      );
    }),
});
