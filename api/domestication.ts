import {
  DomesticationMatrixInput,
  DomesticationUpdateInput,
  NG_STATES,
  STATE_NAMES,
  TRACKED_FEDERAL_LAWS,
  DOMESTICATION_STATUSES,
  type DomesticationMatrix,
  type DomesticationStatus,
} from "@contracts/domestication";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { envelope, apiError, audit } from "./utils/envelope";
import { requireRole } from "./utils/rbac";
import { rowsForLaw, upsertCell } from "./queries/domestication";

/**
 * I7 — State domestication tracker: federal law × (36 states + FCT) grid.
 * Reads are public; updates are data_steward-gated and audited.
 */
export const domesticationRouter = createRouter({
  /** Laws tracked by the matrix (for the UI selector). */
  laws: publicQuery.query(({ ctx }) =>
    envelope(
      TRACKED_FEDERAL_LAWS.map((l) => ({ law_ref: l.lawRef, title: l.title })),
      ctx,
    ),
  ),

  /** 37-row grid for one federal law (missing cells = not_started). */
  matrix: publicQuery
    .input(DomesticationMatrixInput)
    .query(async ({ ctx, input }): Promise<ReturnType<typeof envelope<DomesticationMatrix>>> => {
      const rows = await rowsForLaw(input.law_ref);
      const byState = new Map(rows.map((r) => [r.state, r]));
      const counts = Object.fromEntries(
        DOMESTICATION_STATUSES.map((s) => [s, 0]),
      ) as Record<DomesticationStatus, number>;
      const cells = NG_STATES.map((state) => {
        const r = byState.get(state);
        const status = (r?.status ?? "not_started") as DomesticationStatus;
        counts[status] += 1;
        return {
          state,
          state_name: STATE_NAMES[state],
          status,
          bill_ref: r?.billRef ?? null,
          evidence_ref: r?.evidenceRef ?? null,
          updated_at: r?.updatedAt ?? null,
        };
      });
      return envelope({ law_ref: input.law_ref, cells, counts }, ctx);
    }),

  /** Steward update of one cell (upsert; audited). */
  update: authedQuery
    .input(DomesticationUpdateInput)
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["data_steward"]);
      const updated = await upsertCell({
        lawRef: input.law_ref,
        state: input.state,
        status: input.status,
        billRef: input.bill_ref,
        evidenceRef: input.evidence_ref,
      });
      if (!updated)
        throw apiError(ctx, {
          http: "INTERNAL_SERVER_ERROR",
          code: "DOMESTICATION_UPDATE_FAILED",
          message: "Domestication cell update failed",
          retryable: true,
        });
      audit(ctx, "domestication.cell.updated", {
        type: "domestication_status",
        id: `${input.law_ref}:${input.state}`,
        scopes: ["domestication:write"],
        payload: {
          status: input.status,
          bill_ref: input.bill_ref ?? null,
          evidence_ref: input.evidence_ref ?? null,
        },
      });
      return envelope(updated, ctx);
    }),
});
