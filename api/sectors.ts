import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { assertJurisdictionRead } from "./utils/rbac";
import { envelope } from "./utils/envelope";
import { listSectors, sectorMetricsRange } from "./queries/opportunities";
import { cached } from "./utils/cache";

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
      await assertJurisdictionRead(ctx, input.jurisdiction_id);
      // Hot read path (docs/REDIS.md): sector-metric series change on data
      // loads, not request-to-request — 5-minute read-through cache.
      const rows = await cached(
        `sectors:metrics:${input.jurisdiction_id}:${input.sector_code ?? "*"}:${input.period_from ?? ""}:${input.period_to ?? ""}`,
        300,
        () =>
          sectorMetricsRange({
            jurisdictionId: input.jurisdiction_id,
            sectorCode: input.sector_code,
            periodFrom: input.period_from,
            periodTo: input.period_to,
          }),
      );
      return envelope(rows, ctx);
    }),
});
