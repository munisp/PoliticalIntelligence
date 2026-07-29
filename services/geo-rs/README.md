# geo-rs — high-performance geospatial compute (Rust)

Axum + `geo`/`geojson` (no GDAL) microservice for CPU-bound geospatial
predicates in the policy-twin platform. See `docs/GEOSPATIAL.md` §6.

## Why Rust?

Point-in-polygon spatial joins, geodesic areas and distance filters over
thousands of vertices are CPU-bound. Running them on the Node.js event loop
blocks every concurrent request; the Rust service does this work on a
dedicated tokio thread pool with native-code `geo` kernels, so the API
gateway stays responsive. The platform bridge (`api/bridges/geoRs.ts`) is
remote-first and falls back to an honest in-process TS implementation
(marked `geo_engine: "ts_fallback"`) when the service is not configured.

All endpoints are deterministic (no RNG; request ids are a monotonic
counter) and return the platform envelope `{data, meta{request_id, api_version}}`.
Errors are structured: `{error: {code, message, request_id, retryable}}`.

## Build & run

```bash
cargo build --release
cargo test                       # unit + HTTP tests (Nigeria fixture)
PORT=8500 ./target/release/geo-rs
# or
docker build -t geo-rs . && docker run -p 8500:8500 geo-rs
```

Observability: structured JSON logs via `tracing` (filter with
`RUST_LOG`, e.g. `RUST_LOG=geo_rs=debug`).

## Endpoints

| Method | Path | Body | Result (`data`) |
|---|---|---|---|
| `GET` | `/health` | — | `{status, service, version}` |
| `POST` | `/v1/geo/contains` | `{polygon_geojson, points: [[lng,lat], ...]}` | `{results: [{index, point, properties|null}], polygon_count, geo_engine}` — per-point containing-polygon properties (spatial join) |
| `POST` | `/v1/geo/area-km2` | `{geojson}` | `{areas_km2, total_km2, geo_engine}` — geodesic (Karney, WGS84) areas |
| `POST` | `/v1/geo/within-km` | `{point \| line_geojson, features_geojson, km}` | `{matches: [{index, distance_km, properties}], method, geo_engine}` |
| `POST` | `/v1/geo/simplify` | `{geojson, tolerance}` | `{geojson, vertices_before, vertices_after, geo_engine}` — Visvalingam–Whyatt |

### Method notes (honesty)

- **contains**: planar lon/lat point-in-polygon (`geo::Contains`). Fine at
  admin-boundary scale in Nigeria; not for polar/antimeridian work.
- **within-km**: haversine (R=6371 km) **min-vertex** distance buffer
  approximation — no geodesic buffering, no projected CRS, no segment
  interpolation. A point reference inside a polygon candidate counts as
  distance 0. The exact method string is returned in `data.method`.
- **simplify**: `geo::SimplifyVw` — topology-preserving-*ish*: retained
  vertices are never moved, but rings can collapse at aggressive
  tolerances. Tolerance is in degrees.

### Example

```bash
curl -s localhost:8500/v1/geo/contains -H 'content-type: application/json' -d '{
  "polygon_geojson": <nigeria-states FeatureCollection>,
  "points": [[7.68, 11.03]]
}'
# {"data":{"results":[{"index":0,"point":[7.68,11.03],"properties":{"name":"Kaduna",...}}], ...},
#  "meta":{"request_id":"req_geo_00000001","api_version":"v1"}}
```

## Tests

`cargo test` — unit tests in `src/lib.rs` and HTTP-level tests in
`src/main.rs` against the real `tests/fixtures/nigeria-states.geojson`
(copy of `public/geo/nigeria-states.geojson`): known-area sanity
(Nigeria ≈ 923,768 km² ±10%, Kaduna ≈ 46,053 km² ±25%) and
point-in-Kaduna (Zaria ≈ 7.68, 11.03) containment. No Rust toolchain in
the dev sandbox → CI runs the suite in the Docker builder stage.
