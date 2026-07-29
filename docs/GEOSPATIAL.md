# Geospatial

> **Integration note (one line):** mount `geoRouter` from `api/geo.ts` as
> `geo: geoRouter` in `api/router.ts` (that file is owned by another
> workstream — same pattern as `onboardingRouter`).

## 1. Real boundary artifacts

`scripts/fetch-boundaries.py` fetches **real** administrative polygons
from OpenStreetMap via the Overpass API (mirrors
`overpass.kumi.systems` → `overpass-api.de`), assembles relation way
geometry into rings, and simplifies with Douglas-Peucker (stdlib only).
Successful responses are cached under `public/geo/.cache/`; if all
mirrors fail and no cache exists, the script emits **labeled centroid
fallback features** (real centroid coordinates, `geometry_fallback:
true` in properties) — never a synthetic grid.

| Artifact | Contents | Provenance |
|---|---|---|
| `public/geo/kaduna-lgas.geojson` | 23 real Kaduna LGA polygons, DP-simplified, real centroids (Zaria ≈ 11.03, 7.68) | OSM relations (per-feature `source_url`, e.g. Birnin Gwari relation 3709354); `origin=derived` |
| `public/geo/nigeria-states.geojson` | 37 (36 states + FCT) real state polygons | OSM admin_level=4 relations via Overpass; `origin=derived` |

The same 23 LGA polygons are mirrored into the `geo_boundaries` table
(`unit_id` ↔ `admin_units` ids, e.g. `adm:ng-kd-zaria`) by the
idempotent seed (`db/seed.ts`).

## 2. Query layer (`api/queries/geo.ts`)

When `POSTGIS_URL` is configured **and** a `pg` driver is resolvable,
queries run as real PostGIS spatial predicates:

- within-radius: `ST_DWithin` / `ST_Distance` on `geography`;
- containment: `ST_Contains(ST_GeomFromGeoJSON(...), geom)`.

Otherwise the **MySQL fallback** runs the same shapes:

- within-radius: bounding-box prefilter (uses
  `facilities_lat_lon_idx`) + haversine distances;
- point-in-polygon: ray-casting against the real boundary polygons in
  `geo_boundaries`.

Every response carries `engine: "postgis" | "mysql"` so the execution
path is visible.

Integration coverage: `api/tests/geo-postgis.test.ts` exercises the PostGIS
adapter end-to-end when `POSTGIS_URL` is reachable and skips cleanly
otherwise (vitest conditional pattern — no hard PostGIS dependency in CI).

## 3. API (`api/geo.ts`, default export)

| Procedure | Input | Output |
|---|---|---|
| `geo.boundaries` | `{jurisdiction_id, level?}` | GeoJSON FeatureCollection (DB `geo_boundaries`, file fallback) |
| `geo.facilitiesNear` | `{lat, lon, radius_km, type?, limit?}` | `{items: [...{distance_km}], engine}` |
| `geo.lgaSummary` | `{jurisdiction_id}` | `{items: per-LGA {facility_count, by_type, centroid}, engine}` — choropleth-ready |

Contracts: `contracts/geo.ts` (zod inputs + GeoJSON/result types).

## 4. Schema (additive, `db/schema.ts`)

- `geo_boundaries` (`unit_id` PK, `level`, `geojson` json,
  `centroid_lat/lon`, provenance columns);
- `facilities` gains the `facilities_lat_lon_idx (lat, lon)` index.

DDL was applied to the real TiDB with direct idempotent SQL
(`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX`, duplicate-name tolerant)
because `drizzle-kit push` is interactive on this TiDB; columns verified
via `information_schema`.

## 5. Tests

`api/tests/geo.test.ts` asserts (against the seeded DB): the Kaduna LGA
boundary collection has 23 features with real centroids (Zaria within
0.1° of 11.08, 7.72), `facilitiesNear` finds seeded facilities around
Zaria, and `lgaSummary` attributes facilities to LGAs via real polygons.
