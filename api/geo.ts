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
  spatialJoinInput,
  withinKmInput,
} from "@contracts/geo";
import { boundaryFeatures, facilitiesNear, lgaSummary } from "./queries/geo";
import { cached } from "./utils/cache";
import { spatialJoin, withinKm } from "./bridges/geoRs";

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
      // Hot read path (docs/REDIS.md): facility listing for a radius query;
      // 2-minute read-through cache keyed on the full input.
      const res = await cached(
        `geo:facilitiesNear:${JSON.stringify(input)}`,
        120,
        () => facilitiesNear(input),
      );
      return envelope(res, ctx);
    }),

  /** Per-LGA facility counts for choropleth maps. */
  lgaSummary: publicQuery
    .input(lgaSummaryInput)
    .query(async ({ ctx, input }) => {
      const res = await lgaSummary(input.jurisdiction_id);
      return envelope(res, ctx);
    }),

  /**
   * Point-in-polygon spatial join via the geo-rs Rust service
   * (services/geo-rs) with in-process TS fallback — result carries
   * `geo_engine: "rust" | "ts_fallback"`.
   */
  spatialJoin: publicQuery
    .input(spatialJoinInput)
    .query(async ({ ctx, input }) => {
      const res = await spatialJoin({
        polygon_geojson: input.polygon_geojson,
        points: input.points as [number, number][],
      });
      return envelope(res, ctx);
    }),

  /** Features within km of a point/line (geo-rs, haversine approximation). */
  withinKm: publicQuery
    .input(withinKmInput)
    .query(async ({ ctx, input }) => {
      const res = await withinKm({
        point: input.point as [number, number] | undefined,
        line_geojson: input.line_geojson,
        features_geojson: input.features_geojson,
        km: input.km,
      });
      return envelope(res, ctx);
    }),
});

export default geoRouter;
