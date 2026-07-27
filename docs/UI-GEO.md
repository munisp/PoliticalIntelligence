# UI ↔ Geo API wiring (feat-v4-frontend)

Closes audit finding #4 (UI never consumed the geo API). All changes are in
`src/` and are additive/backward-compatible.

## What's wired

| Surface | Consumes | Behaviour |
|---|---|---|
| `src/components/shared/MapPanel.tsx` | — (presentational) | New optional props: `geoJson`, `values`, `facilityCounts`, `onSelectUnit`, `selectedUnit`, `markers`, `provenanceUrl`, `engine`, `mapHeight`. With `geoJson`, renders **real boundary polygons** via an inline-SVG equirectangular fit-to-bbox projection (no new deps): choropleth fill, hover tooltip (unit name + value + facility count), click → `onSelectUnit`, legend (auto range `0 → max` for counts, `0.0 → 1.0` for indices), facility markers with type-coloured dots + count badge, and a "Boundaries: OSM live" provenance chip (from `properties.source_url`). `engine="maplibre"` keeps the previous MapLibre GL upgrade path. Without `geoJson`, the existing 6×4 SVG grid renders unchanged (no regressions). "View data as table" is fed by the real `values`/`facilityCounts` when provided. |
| `src/pages/Opportunities.tsx` | `geo.boundaries`, `geo.lgaSummary`, `geo.facilitiesNear` (typed tRPC hooks, `unwrapData`, `isProcedureMissing` retry policy) | Real 23-LGA choropleth. Layer toggles: **Opportunity score** / **Unemployment** / **Travel-time** keep the deterministic derived 0–1 per-LGA index (`lgaLayerValue`, stable-hash — documented in `types.ts`); **School density** uses real per-LGA school counts (`lgaSummary.by_type` matched on /school\|education\|academy/i) when available; **Facilities** (new layer) uses real per-LGA `facility_count` plus `geo.facilitiesNear` markers around the selected LGA centroid (25 km) or the state centroid mean (60 km). Clicking a polygon scopes the explorer filter to that LGA. |
| `src/components/dashboard/LgaMiniMap.tsx` + `src/pages/Dashboard.tsx` | `geo.boundaries`, `geo.lgaSummary` | Lazy (`React.lazy` + `Suspense`) compact 220px real-polygon choropleth of facilities per LGA below the Sector highlights section. Renders nothing if the geo router is missing. |

## Derivation notes

- Opportunities are stored at state level; per-LGA opportunity values remain a
  transparent deterministic index (`baseOpportunityScore × stableHash jitter`),
  unchanged from before. Real measured per-LGA values now come from the geo API:
  `facility_count` and the `by_type` breakdown (schools layer).
- Choropleth colour normalisation: raw values > 1 are treated as counts and
  normalised by the per-dataset max; 0–1 indices are used directly.

## Fallbacks (graceful degradation)

- Geo procedures missing/errored (`isProcedureMissing` → no retry):
  Opportunities map falls back to the existing derived SVG grid; the Dashboard
  mini-map renders nothing; facilities layer shows per-LGA counts without
  markers (with a small status note when `facilitiesNear` fails).
- The boundary polygons also ship statically at `/geo/kaduna-lgas.geojson`
  (OSM-derived, `source_url` per feature drives the provenance chip).

## i18n expansion (same branch)

- Packs `en/ha/yo/ig` extended with ~27 new keys each (`nav.*` full/short
  labels, `layout.*` chrome/aria strings, `opportunities.*` header,
  `login.*`), professionally translated.
- `useT()` applied additively to: Layout sidebar nav labels (`NavLabel`
  component keyed by `tKey`), topbar aria-labels + search placeholder + jobs /
  approval / role-switcher strings, bottom nav, Opportunities page header
  (caption/title/subtitle/compare/generate), Login page (welcome/sign-in).
- `LanguageSwitcher` added to the Layout topbar next to the role switcher
  (`{/* I18N-SLOT */}`); `LocaleProvider` mounted in `src/main.tsx` around
  `<App/>` inside `TRPCProvider`. Default locale remains English; choice
  persists in `localStorage`.
