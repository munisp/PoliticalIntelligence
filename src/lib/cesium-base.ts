/**
 * GEO-2: Cesium runtime bootstrap.
 *
 * Sets the global `CESIUM_BASE_URL` BEFORE any `cesium` module is evaluated
 * so workers, widgets and assets resolve from the locally-copied runtime in
 * `public/cesium/` (populated by vite-plugin-static-copy — see vite.config.ts).
 * No Cesium Ion token is used anywhere: imagery comes from OSM tiles.
 *
 * Import this module first (side-effect) in any file that imports `cesium`.
 */
(window as unknown as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = "/cesium/";

export const CESIUM_BASE_URL = "/cesium/";
