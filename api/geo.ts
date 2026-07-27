/**
 * Geospatial router (feat-data-loader — docs/GEOSPATIAL.md).
 *
 * INTEGRATION: mount as `geo: geoRouter` in api/router.ts
 * (owned by another workstream — same pattern as onboardingRouter).
 */
import { createRouter, publicQuery } from "./middleware";
import { envelope } from "./utils/envelope";
import {
  facilitiesNearInput,
  geoBoundariesInput,
  lgaSummaryInput,
} from "@contracts/geo";
import { boundaryFeatures, facilitiesNear, lgaSummary } from "./queries/geo";

export const geoRouter = createRouter({
  /** Real boundary polygons (GeoJSON FeatureCollection) for a jurisdiction. */
  boundaries: publicQuery
    .input(geoBoundariesInput)
    .query(async ({ ctx, input }) => {
      const fc = await boundaryFeatures(input.jurisdiction_id);
      return envelope(fc, ctx);
    }),

  /** Facilities within a radius (PostGIS ST_DWithin or haversine fallback). */
  facilitiesNear: publicQuery
    .input(facilitiesNearInput)
    .query(async ({ ctx, input }) => {
      const res = await facilitiesNear(input);
      return envelope(res, ctx);
    }),

  /** Per-LGA facility counts for choropleth maps. */
  lgaSummary: publicQuery
    .input(lgaSummaryInput)
    .query(async ({ ctx, input }) => {
      const res = await lgaSummary(input.jurisdiction_id);
      return envelope(res, ctx);
    }),
});

export default geoRouter;
