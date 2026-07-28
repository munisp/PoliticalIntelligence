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

export interface LgaSummaryEntry {
  unit_id: string;
  name: string;
  centroid_lat: number | null;
  centroid_lon: number | null;
  facility_count: number;
  by_type: Record<string, number>;
}
