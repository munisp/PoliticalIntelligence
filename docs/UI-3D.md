# UI-3D — CesiumJS Geospatial View (GEO-2)

Token-free 3D geospatial surface for Kaduna State LGAs, shipped as the
`/geo3d` route (secondary nav, `Globe2` icon, `{/* GEO3D-NAV */}`).

## Architecture

```
src/pages/Geo3D.tsx                  page: data wiring, 2D/3D toggle, low-bandwidth guard, infobox
src/components/geo/Cesium3DView.tsx  lazy Cesium viewer (React.lazy + Suspense skeleton)
src/components/shared/MapPanel.tsx   2D GeoJSON fallback (existing SVG engine)
src/lib/cesium-base.ts               sets window.CESIUM_BASE_URL = "/cesium/" before cesium evaluates
vite.config.ts                       vite-plugin-static-copy → public/cesium/{Workers,Widgets,Assets,ThirdParty}
public/geo/kaduna-lgas.geojson       built-in boundaries (static fallback)
```

- **Code splitting.** `Cesium3DView` is only imported through `React.lazy`,
  so cesium (~1 MB+ gzipped JS) lives in its own async chunk; the main bundle
  is unaffected until a user opens the 3D view.
- **Asset serving.** Cesium's web workers, widget CSS and imagery assets are
  copied at build time into `dist/public/cesium/` and served from our own
  origin. `src/lib/cesium-base.ts` sets the global `CESIUM_BASE_URL` *before*
  the cesium module is evaluated (import order matters — it is imported
  first in `Cesium3DView.tsx`).
- **PWA.** `globIgnores: ["cesium/**"]` keeps the runtime out of the service
  worker precache; assets stream on demand.

## Token-free providers

| Concern  | Provider                                   | Token needed |
|----------|--------------------------------------------|--------------|
| Imagery  | `OpenStreetMapImageryProvider` (OSM tiles) | No           |
| Terrain  | WGS84 ellipsoid (Cesium default)           | No           |
| Geocoder | disabled                                   | —            |

No `Ion.defaultAccessToken` is set anywhere. The terrain is therefore flat
(ellipsoid) — accurate enough for LGA extrusion visualisation; the page shows
a terrain note in the footer.

## Data flow

1. **Boundaries** — `trpc.geo.boundaries` (envelope-unwrapped), falling back
   to `public/geo/kaduna-lgas.geojson` when the procedure is missing or
   errors (a warning chip is shown on fallback).
2. **Extrusion heights** — `trpc.geo.lgaSummary` facility counts per LGA,
   normalised against the max count: `2000 m + (count/max) × 48000 m`.
   Without the summary the polygons still render with the base extrusion.
3. **Infobox** — clicking an extruded polygon (or a 2D unit) selects the LGA:
   name, facility count, by-type breakdown, and the state-wide ranked
   opportunity count (rankings are jurisdiction-scoped; per-LGA opportunity
   scoring is a future server enhancement).

## Low-bandwidth behaviour

- `navigator.connection.saveData` or a `2g`/`slow-2g` effective type ⇒ the
  page defaults to the 2D GeoJSON map with a "Load 3D anyway" opt-in; the
  cesium chunk and OSM tiles are never fetched until the user opts in.
- `prefers-reduced-data: reduce` CSS hook hides `[data-decorative]` imagery
  (e.g. the landing topo background).
- The viewer uses `requestRenderMode: true` so frames are rendered on demand
  (interaction/data change) rather than in a continuous loop.

## Fallback matrix

| Condition                              | What renders                                   |
|----------------------------------------|------------------------------------------------|
| Full capability                        | Cesium 3D, extruded LGA polygons, OSM imagery  |
| saveData / 2g connection               | 2D GeoJSON map + explicit 3D opt-in button     |
| User toggles 2D                        | 2D GeoJSON map (same selection + infobox)      |
| `geo.boundaries` unavailable           | Built-in `/geo/kaduna-lgas.geojson` + chip     |
| `geo.lgaSummary` unavailable           | Polygons at base extrusion; infobox shows "—"  |
| WebGL unavailable                      | Cesium fails inside the lazy boundary; use 2D  |

## Enabling Cesium Ion later

1. Create an Ion account, add the token to runtime env
   (`VITE_CESIUM_ION_TOKEN`), and set
   `Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN` in
   `src/lib/cesium-base.ts` (guard for undefined so token-free deployments
   keep working).
2. Terrain: replace the ellipsoid default with
   `viewer.scene.setTerrain(new Terrain(CesiumTerrainProvider.fromIonAssetId(1)))`
   (Cesium World Terrain, asset 1) behind a feature flag.
3. Imagery upgrade: `ImageryLayer.fromIonAssetId(2)` (Bing Aerial) or keep
   OSM — the base layer is a single constructor argument in
   `Cesium3DView.tsx`.
4. Re-run the low-bandwidth tests: terrain tiles add significant weight, so
   keep the opt-in gate ahead of any terrain enablement.

## Performance notes

- Cesium chunk is loaded on demand only (verify with
  `npm run build` — look for a large `Cesium3DView-*.js` chunk).
- GeoJSON datasource is reloaded only when boundaries or values change; the
  viewer instance is created once per mount and fully destroyed on unmount
  (`handler.destroy()` + `viewer.destroy()`).
- 23 simplified LGA polygons keep primitive counts trivially low; no
  clustering or culling is required at this scale.
