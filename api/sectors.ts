import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { envelope } from "./utils/envelope";
import { listSectors, sectorMetricsRange } from "./queries/opportunities";

export const sectorsRouter = createRouter({
  list: publicQuery.query(async ({ ctx }) => {
    return envelope(await listSectors(), ctx);
  }),

  metrics: publicQuery
    .input(
      z.object({
        jurisdiction_id: z.string().min(1),
        sector_code: z.string().optional(),
        /** Period range, inclusive, e.g. "2022".."2025". */
        period_from: z.string().optional(),
        period_to: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await sectorMetricsRange({
        jurisdictionId: input.jurisdiction_id,
        sectorCode: input.sector_code,
        periodFrom: input.period_from,
        periodTo: input.period_to,
      });
      return envelope(rows, ctx);
    }),
});
