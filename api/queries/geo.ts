/**
 * Geospatial queries (feat-data-loader — docs/GEOSPATIAL.md).
 *
 * PostGIS path (when POSTGIS_URL is configured and a `pg` driver is
 * resolvable): real spatial predicates — ST_DWithin for radius queries,
 * ST_Contains for point-in-polygon — against a `facilities`/`boundaries`
 * mirror in PostGIS.
 *
 * Fallback path (default): MySQL bounding-box prefilter + haversine
 * distances, and ray-casting point-in-polygon against the real boundary
 * polygons stored in `geo_boundaries`. Same result shapes either way.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { and, between, eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import type {
  FacilityNearResult,
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  LgaSummaryEntry,
} from "@contracts/geo";
import { getDb } from "./connection";

/* ------------------------------------------------------------------ */
/* PostGIS adapter (optional — gated on POSTGIS_URL + pg driver)       */
/* ------------------------------------------------------------------ */

type PgClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  end: () => Promise<void>;
};

async function pgClient(): Promise<PgClient | null> {
  const url = process.env.POSTGIS_URL;
  if (!url) return null;
  try {
    // Fully dynamic so bundlers/typecheck don't require the optional dep.
    const importer = new Function("spec", "return import(spec)") as (
      s: string,
    ) => Promise<{ Client: new (c: { connectionString: string }) => PgClient & { connect(): Promise<void> } }>;
    const { Client } = await importer("pg");
    const client = new Client({ connectionString: url });
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Boundary features                                                    */
/* ------------------------------------------------------------------ */

const GEO_DIR = path.resolve(process.cwd(), "public", "geo");

/** unit_id prefix for a jurisdiction's LGA boundaries ("jur:ng-kd" -> "adm:ng-kd"). */
function unitPrefix(jurisdictionId: string): string {
  const bare = jurisdictionId.replace(/^jur:/, "");
  return `adm:${bare}`;
}

export async function boundaryFeatures(
  jurisdictionId: string,
): Promise<GeoJsonFeatureCollection> {
  const prefix = unitPrefix(jurisdictionId);
  const rows = await getDb()
    .select()
    .from(schema.geoBoundaries)
    .where(
      and(
        eq(schema.geoBoundaries.level, "lga"),
        sql`${schema.geoBoundaries.unitId} LIKE ${prefix + "-%"}`,
      ),
    );
  if (rows.length > 0) {
    return {
      type: "FeatureCollection",
      name: `${prefix}-lgas`,
      metadata: { source: "db:geo_boundaries", count: rows.length },
      features: rows.map((r) => {
        const geometry = r.geojson as GeoJsonFeature["geometry"];
        return {
          type: "Feature",
          properties: {
            unit_id: r.unitId,
            level: r.level,
            centroid_lat: r.centroidLat,
            centroid_lon: r.centroidLon,
            origin: r.origin,
            source_url: r.sourceUrl,
          },
          geometry,
        };
      }),
    };
  }
  // File fallback (public/geo artifacts produced by scripts/fetch-boundaries.py).
  const bare = jurisdictionId.replace(/^jur:/, "");
  const file = path.join(GEO_DIR, `${bare}-lgas.geojson`);
  if (existsSync(file)) {
    return JSON.parse(readFileSync(file, "utf8")) as GeoJsonFeatureCollection;
  }
  return { type: "FeatureCollection", features: [] };
}

/* ------------------------------------------------------------------ */
/* Within-radius facilities                                             */
/* ------------------------------------------------------------------ */

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
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

export async function facilitiesNear(input: {
  lat: number;
  lon: number;
  radius_km: number;
  type?: string;
  limit: number;
}): Promise<{ items: FacilityNearResult[]; engine: "postgis" | "mysql" }> {
  const pg = await pgClient();
  if (pg) {
    try {
      const res = await pg.query(
        `SELECT facility_id, jurisdiction_id, type, name, lat, lon, origin,
                ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography)/1000.0 AS distance_km
           FROM facilities
          WHERE ($3::text IS NULL OR type = $3)
            AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $4)
          ORDER BY distance_km ASC
          LIMIT $5`,
        [input.lon, input.lat, input.type ?? null, input.radius_km * 1000, input.limit],
      );
      return {
        items: (res.rows as FacilityNearResult[]).map((r) => ({
          ...r,
          distance_km: Number(r.distance_km),
        })),
        engine: "postgis",
      };
    } finally {
      await pg.end();
    }
  }

  // MySQL fallback: bbox prefilter (facilities_lat_lon_idx) + haversine.
  const dLat = input.radius_km / 111.32;
  const dLon =
    input.radius_km / (111.32 * Math.cos((input.lat * Math.PI) / 180) || 1e-9);
  const conds = [
    between(schema.facilities.lat, input.lat - dLat, input.lat + dLat),
    between(schema.facilities.lon, input.lon - dLon, input.lon + dLon),
  ];
  if (input.type) conds.push(eq(schema.facilities.type, input.type));
  const rows = await getDb()
    .select()
    .from(schema.facilities)
    .where(and(...conds));
  const items = rows
    .filter((r) => r.lat !== null && r.lon !== null)
    .map((r) => ({
      facility_id: r.facilityId,
      jurisdiction_id: r.jurisdictionId,
      type: r.type,
      name: r.name,
      lat: r.lat as number,
      lon: r.lon as number,
      distance_km: haversineKm(input.lat, input.lon, r.lat as number, r.lon as number),
      origin: r.origin,
    }))
    .filter((r) => r.distance_km <= input.radius_km)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, input.limit);
  return { items, engine: "mysql" };
}

/* ------------------------------------------------------------------ */
/* Per-LGA facility summary (choropleth)                                */
/* ------------------------------------------------------------------ */

type Ring = [number, number][];

function ringsOf(f: GeoJsonFeature): Ring[] {
  const g = f.geometry;
  if (g.type === "Polygon") return (g.coordinates as number[][][]).map((r) => r as Ring);
  if (g.type === "MultiPolygon")
    return (g.coordinates as number[][][][]).flat().map((r) => r as Ring);
  return [];
}

/** Ray-casting point-in-polygon (lon/lat planar — fine at LGA scale). */
export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInFeature(
  lon: number,
  lat: number,
  f: GeoJsonFeature,
): boolean {
  return ringsOf(f).some((ring) => pointInRing(lon, lat, ring));
}

export async function lgaSummary(jurisdictionId: string): Promise<{
  items: LgaSummaryEntry[];
  engine: "postgis" | "mysql";
}> {
  const fc = await boundaryFeatures(jurisdictionId);
  const bare = jurisdictionId.replace(/^jur:/, "");
  const facilities = await getDb()
    .select()
    .from(schema.facilities)
    .where(
      sql`${schema.facilities.jurisdictionId} IN (${jurisdictionId}, ${bare}, ${`jur:${bare}`})`,
    );

  const pg = await pgClient();
  if (pg) {
    // PostGIS containment per boundary (boundaries mirrored server-side).
    try {
      const items: LgaSummaryEntry[] = [];
      for (const f of fc.features) {
        const res = await pg.query(
          `SELECT count(*)::int AS n FROM facilities
            WHERE ST_Contains(ST_SetSRID(ST_GeomFromGeoJSON($1),4326), geom)`,
          [JSON.stringify(f.geometry)],
        );
        const byType: Record<string, number> = {};
        const tRes = await pg.query(
          `SELECT type, count(*)::int AS n FROM facilities
            WHERE ST_Contains(ST_SetSRID(ST_GeomFromGeoJSON($1),4326), geom)
            GROUP BY type`,
          [JSON.stringify(f.geometry)],
        );
        for (const row of tRes.rows as { type: string; n: number }[])
          byType[row.type] = Number(row.n);
        items.push({
          unit_id: String(f.properties.unit_id ?? ""),
          name: String(f.properties.name ?? f.properties.lga ?? ""),
          centroid_lat: (f.properties.centroid_lat as number) ?? null,
          centroid_lon: (f.properties.centroid_lon as number) ?? null,
          facility_count: Number((res.rows[0] as { n: number }).n),
          by_type: byType,
        });
      }
      return { items, engine: "postgis" };
    } finally {
      await pg.end();
    }
  }

  // Fallback: point-in-polygon against the real boundary polygons.
  const items: LgaSummaryEntry[] = fc.features.map((f) => {
    const inside = facilities.filter(
      (fac) =>
        fac.lat !== null &&
        fac.lon !== null &&
        pointInFeature(fac.lon, fac.lat, f),
    );
    const byType: Record<string, number> = {};
    for (const fac of inside) byType[fac.type] = (byType[fac.type] ?? 0) + 1;
    return {
      unit_id: String(f.properties.unit_id ?? ""),
      name: String(f.properties.name ?? f.properties.lga ?? ""),
      centroid_lat: (f.properties.centroid_lat as number) ?? null,
      centroid_lon: (f.properties.centroid_lon as number) ?? null,
      facility_count: inside.length,
      by_type: byType,
    };
  });
  return { items, engine: "mysql" };
}
