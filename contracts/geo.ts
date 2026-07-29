import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Geospatial contracts (feat-data-loader — docs/GEOSPATIAL.md)        */
/* ------------------------------------------------------------------ */

export const geoBoundariesInput = z.object({
  jurisdiction_id: z.string().min(1),
  /** Boundary level to return (default: lga). */
  level: z.enum(["state", "lga", "ward"]).default("lga"),
});
export type GeoBoundariesInput = z.infer<typeof geoBoundariesInput>;

export const facilitiesNearInput = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radius_km: z.number().positive().max(500),
  type: z.string().max(64).optional(),
  limit: z.number().int().min(1).max(500).default(100),
});
export type FacilitiesNearInput = z.infer<typeof facilitiesNearInput>;

export const lgaSummaryInput = z.object({
  jurisdiction_id: z.string().min(1),
});
export type LgaSummaryInput = z.infer<typeof lgaSummaryInput>;

/** GeoJSON primitives (structural — full validation is overkill here). */
export type GeoJsonGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }
  | { type: "Point"; coordinates: number[] }
  | { type: string; coordinates: unknown };

export interface GeoJsonFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: GeoJsonGeometry;
}

export interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  name?: string;
  metadata?: Record<string, unknown>;
  features: GeoJsonFeature[];
}

export interface FacilityNearResult {
  facility_id: string;
  jurisdiction_id: string;
  type: string;
  name: string;
  lat: number;
  lon: number;
  distance_km: number;
  origin: string;
}

/* ------------------------------------------------------------------ */
/* geo-rs compute bridge (services/geo-rs — docs/GEOSPATIAL.md §6)     */
/* ------------------------------------------------------------------ */

const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const spatialJoinInput = z.object({
  /** GeoJSON Feature/FeatureCollection/Geometry of polygons. */
  polygon_geojson: z.unknown(),
  /** Points as [lng, lat] pairs (max 10k per call). */
  points: z.array(lngLat).min(1).max(10_000),
});
export type SpatialJoinInput = z.infer<typeof spatialJoinInput>;

export const withinKmInput = z
  .object({
    /** Reference point [lng, lat] (or supply line_geojson). */
    point: lngLat.optional(),
    /** Reference line (GeoJSON LineString) — alternative to point. */
    line_geojson: z.unknown().optional(),
    /** Candidate features (GeoJSON FeatureCollection). */
    features_geojson: z.unknown(),
    km: z.number().positive().max(1000),
  })
  .refine((v) => v.point !== undefined || v.line_geojson !== undefined, {
    message: "provide either point or line_geojson",
  });
export type WithinKmInput = z.infer<typeof withinKmInput>;

export type GeoEngine = "rust" | "ts_fallback";

export interface SpatialJoinHit {
  index: number;
  point: [number, number];
  properties: Record<string, unknown> | null;
}

export interface SpatialJoinResult {
  results: SpatialJoinHit[];
  polygon_count: number;
  geo_engine: GeoEngine;
}

export interface WithinKmMatch {
  index: number;
  distance_km: number;
  properties: Record<string, unknown>;
}

export interface WithinKmResult {
  matches: WithinKmMatch[];
  method: string;
  geo_engine: GeoEngine;
}

export interface LgaSummaryEntry {
  unit_id: string;
  name: string;
  centroid_lat: number | null;
  centroid_lon: number | null;
  facility_count: number;
  by_type: Record<string, number>;
}
