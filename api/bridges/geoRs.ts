/**
 * Bridge to the geo-rs Rust microservice (services/geo-rs —
 * docs/GEOSPATIAL.md §6): CPU-bound geo predicates (point-in-polygon
 * spatial join, haversine distance filters) off the Node event loop.
 *
 * Remote-first: when GEO_RS_URL is configured and reachable, calls
 * POST /v1/geo/contains and /v1/geo/within-km. Otherwise an in-process
 * TS fallback mirrors the same methods (ray-casting PIP shared with
 * api/queries/geo.ts; vertex-min haversine) and the result is honestly
 * marked `geo_engine: "ts_fallback"` vs `"rust"`.
 */
import type {
  GeoEngine,
  SpatialJoinHit,
  SpatialJoinResult,
  WithinKmMatch,
  WithinKmResult,
} from "@contracts/geo";
import type { GeoJsonFeature } from "@contracts/geo";
import { pointInFeature } from "../queries/geo";

const BASE_URL = process.env.GEO_RS_URL; // unset → TS fallback
const TIMEOUT_MS = 4000;

export const WITHIN_KM_METHOD =
  "haversine (R=6371km) min vertex distance buffer approximation — no geodesic buffering, no projected CRS; polygon containment counts as distance 0";

interface Envelope<T> {
  data: T;
  meta: { request_id: string; api_version: string };
}

/** POST to geo-rs; null when unconfigured/unreachable/invalid. */
async function postRemote<T>(
  path: string,
  body: unknown,
  validate: (v: unknown) => v is T,
): Promise<T | null> {
  if (!BASE_URL) return null;
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Envelope<unknown>;
    if (json && typeof json === "object" && "data" in json && validate(json.data)) {
      return json.data;
    }
    return null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* TS fallback kernels (mirror of services/geo-rs/src/lib.rs)          */
/* ------------------------------------------------------------------ */

function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** All vertices of a GeoJSON geometry, flattened. */
function coordsOf(geom: GeoJsonFeature["geometry"]): [number, number][] {
  const c = geom.coordinates as unknown;
  const out: [number, number][] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number") {
      out.push([v[0] as number, v[1] as number]);
      return;
    }
    if (Array.isArray(v)) v.forEach(walk);
  };
  walk(c);
  return out;
}

export function featuresOfGeoJson(gj: unknown): GeoJsonFeature[] {
  const v = gj as { type?: string; features?: GeoJsonFeature[]; geometry?: GeoJsonFeature["geometry"] };
  if (!v || typeof v !== "object") return [];
  if (v.type === "FeatureCollection" && Array.isArray(v.features)) return v.features;
  if (v.type === "Feature" && v.geometry) return [v as GeoJsonFeature];
  if (v.type && "coordinates" in (v as object)) {
    return [{ type: "Feature", properties: {}, geometry: v as GeoJsonFeature["geometry"] }];
  }
  return [];
}

/** Fallback point-in-polygon join (ray-casting via queries/geo). */
export function containsFallback(
  polygonGeojson: unknown,
  points: [number, number][],
): SpatialJoinHit[] {
  const polys = featuresOfGeoJson(polygonGeojson).filter((f) =>
    /Polygon/.test(f.geometry.type),
  );
  return points.map((p, index) => {
    const hit = polys.find((f) => pointInFeature(p[0], p[1], f));
    return { index, point: p, properties: hit ? { ...hit.properties } : null };
  });
}

/** Fallback haversine min-vertex distance filter (mirrors Rust method). */
export function withinKmFallback(input: {
  point?: [number, number];
  line_geojson?: unknown;
  features_geojson: unknown;
  km: number;
}): WithinKmMatch[] {
  const refCoords: [number, number][] = input.point
    ? [input.point]
    : coordsOf(
        (featuresOfGeoJson(input.line_geojson)[0]?.geometry ?? {
          type: "Point",
          coordinates: [],
        }) as GeoJsonFeature["geometry"],
      );
  const candidates = featuresOfGeoJson(input.features_geojson);
  const matches: WithinKmMatch[] = [];
  candidates.forEach((f, index) => {
    let min = Number.POSITIVE_INFINITY;
    if (
      input.point &&
      /Polygon/.test(f.geometry.type) &&
      pointInFeature(input.point[0], input.point[1], f)
    ) {
      min = 0;
    } else {
      for (const [ax, ay] of refCoords) {
        for (const [bx, by] of coordsOf(f.geometry)) {
          const d = haversineKm(ax, ay, bx, by);
          if (d < min) min = d;
        }
      }
    }
    if (min <= input.km) {
      matches.push({ index, distance_km: min, properties: { ...f.properties } });
    }
  });
  return matches.sort((a, b) => a.distance_km - b.distance_km);
}

/* ------------------------------------------------------------------ */
/* Remote-first entry points                                           */
/* ------------------------------------------------------------------ */

function isSpatialJoinData(v: unknown): v is Omit<SpatialJoinResult, "geo_engine"> {
  const d = v as SpatialJoinResult;
  return Array.isArray(d?.results) && typeof d?.polygon_count === "number";
}

function isWithinKmData(v: unknown): v is Omit<WithinKmResult, "geo_engine"> {
  const d = v as WithinKmResult;
  return Array.isArray(d?.matches);
}

/** Spatial join: per-point containing-polygon properties. Remote-first. */
export async function spatialJoin(input: {
  polygon_geojson: unknown;
  points: [number, number][];
}): Promise<SpatialJoinResult> {
  const remote = await postRemote(
    "/v1/geo/contains",
    { polygon_geojson: input.polygon_geojson, points: input.points },
    isSpatialJoinData,
  );
  if (remote) {
    return {
      results: remote.results as SpatialJoinHit[],
      polygon_count: remote.polygon_count,
      geo_engine: "rust" as GeoEngine,
    };
  }
  const results = containsFallback(input.polygon_geojson, input.points);
  return {
    results,
    polygon_count: featuresOfGeoJson(input.polygon_geojson).length,
    geo_engine: "ts_fallback",
  };
}

/** Distance filter: candidate features within km of a point/line. Remote-first. */
export async function withinKm(input: {
  point?: [number, number];
  line_geojson?: unknown;
  features_geojson: unknown;
  km: number;
}): Promise<WithinKmResult> {
  const remote = await postRemote(
    "/v1/geo/within-km",
    {
      point: input.point,
      line_geojson: input.line_geojson,
      features_geojson: input.features_geojson,
      km: input.km,
    },
    isWithinKmData,
  );
  if (remote) {
    return {
      matches: remote.matches as WithinKmMatch[],
      method: remote.method ?? WITHIN_KM_METHOD,
      geo_engine: "rust",
    };
  }
  return {
    matches: withinKmFallback(input),
    method: WITHIN_KM_METHOD,
    geo_engine: "ts_fallback",
  };
}
