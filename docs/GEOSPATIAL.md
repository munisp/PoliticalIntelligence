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

## 6. GeoLibre copilot tool (`services/ai/app/tools/geolibre_tool.py`)

Natural-language geospatial QA for the copilot, registered in the tool
registry (`app/tools`, exposed at `GET /v1/tools`,
`POST /v1/tools/{name}/invoke`).

Example: *"which states within 50km of the Lagos-Calabar corridor have
unemployment > 24%?"* →

```
1 states within 50km of the Lagos–Calabar corridor with unemployment_rate > 24%:
- Lagos: 0.6km from corridor; unemployment_rate=24.4% (2024-Q2, NBS Labour Force Survey)
```

Pipeline (deterministic, offline-capable):

1. **Intent templates** — regex-parsed: `corridor_proximity` (within N km of
   a named corridor), `within_distance`, `per_lga`; optional metric
   threshold (`unemployment > 24%` → ratio 0.24 against seeded corpus
   metrics).
2. **Execution** — PostGIS when `POSTGIS_URL` + a psycopg driver are
   available, else the seeded geojson artifacts (`public/geo/*.geojson`);
   honest `data_source` marker either way.
3. **Structured answer + map payload** — ranked result rows plus a GeoJSON
   FeatureCollection (corridor LineString + matched boundary features) for
   direct map rendering.

### GeoLibre backend seam (evaluated, not vendored)

[GeoLibre](https://github.com/opengeos/GeoLibre) is the candidate future
AI-geo backend. Integration is HTTP-only: set `GEOLIBRE_URL` and questions
are delegated to `<GEOLIBRE_URL>/query`; any failure falls back to the
template engine. Every response carries `geo_engine: "geolibre" |
"template"` so consumers always know which engine answered — no silent
engine swaps. The library itself is not vendored into this repo.

Corridor geometry: the Lagos–Calabar polyline is a seeded derived waypoint
list (`origin="derived"`), mirrored in
`services/ingestion/app/geo_analytics/sedona_jobs.py` so the batch
(Sedona) and interactive (copilot tool) paths answer consistently.
## 7. Rust compute service (`services/geo-rs`)

CPU-bound geo predicates — point-in-polygon spatial joins, geodesic
areas, distance filters, simplification — run in a dedicated **Rust
(axum + `geo`/`geojson`, no GDAL)** microservice instead of on the
Node.js event loop, keeping the API gateway responsive under heavy
polygon workloads. All endpoints use the standard envelope
`{data, meta{request_id, api_version}}` (request ids are a monotonic
counter — fully deterministic, no RNG), return structured errors
`{error: {code, message, request_id, retryable}}`, and log via
`tracing` JSON.

| Endpoint | Purpose | Method (honest) |
|---|---|---|
| `GET /health` | liveness | — |
| `POST /v1/geo/contains` | per-point containing-polygon properties (spatial join) | planar PIP (`geo::Contains`) |
| `POST /v1/geo/area-km2` | geodesic areas | Karney WGS84 (`geo::GeodesicArea`) |
| `POST /v1/geo/within-km` | features within distance of point/line | haversine (R=6371 km) **min-vertex** buffer approximation — no geodesic buffering, no projected CRS; point-in-polygon counts as 0 |
| `POST /v1/geo/simplify` | simplification | Visvalingam–Whyatt (`geo::SimplifyVw`) — topology-preserving-ish (vertices never moved; rings can collapse at aggressive tolerances) |

### Bridge (`api/bridges/geoRs.ts`)

Remote-first to `GEO_RS_URL` (4s timeout, envelope + shape validation).
When the service is unconfigured or unreachable, an in-process TS
fallback mirrors the contains / within-km kernels (ray-casting PIP
shared with `api/queries/geo.ts`, haversine min-vertex) and every
result is honestly marked `geo_engine: "rust" | "ts_fallback"`.

New procedures on the existing geo router (`api/geo.ts`):

| Procedure | Input | Output |
|---|---|---|
| `geo.spatialJoin` | `{polygon_geojson, points: [[lng,lat]]}` | `{results: [{index, point, properties|null}], polygon_count, geo_engine}` |
| `geo.withinKm` | `{point \| line_geojson, features_geojson, km}` | `{matches: [{index, distance_km, properties}], method, geo_engine}` |

Contracts: `contracts/geo.ts` (`spatialJoinInput`, `withinKmInput`).

### Deploy & tests

- Compose: `geo-rs` service (default-on, 1 CPU / 256 Mi limit,
  port 8500); the gateway gets `GEO_RS_URL: http://geo-rs:8500`.
- K8s: `infra/k8s/base/geo-rs.yaml` (1 dev replica, 50m/64Mi requests).
- `cargo test` (unit + HTTP tests against the real
  `tests/fixtures/nigeria-states.geojson` — Nigeria total ≈ 923,768 km²
  ±10% sanity, Zaria-in-Kaduna containment) runs in the Docker builder
  stage; the dev sandbox has no Rust toolchain.
- `api/tests/geo-rs.test.ts` (vitest): fallback kernels, remote-first
  honesty markers, and procedure envelope.
