# PWA Evidence Pack — Mobile/PWA requirement

This document is the evidence trail for the PWA / offline-tolerance
requirement (COMPLIANCE UX-8) and the relationship to the Capacitor shell
(MOB-1). Every claim links to the file that proves it; an automated smoke
suite (`src/__tests__/pwa.test.ts`, 17 tests) re-verifies the whole contract
on every `npm run test`.

## 1. Feature checklist with evidence paths

| Feature | Status | Evidence |
| --- | --- | --- |
| Web app manifest (name, short_name, standalone, start_url/scope, theme/background colors, 512px + maskable 512px icons) | ✅ | `public/manifest.webmanifest`, icons in `public/pwa-icon-512.png`; asserted by `pwa.test.ts` → "web app manifest" |
| Service worker (autoUpdate, app-shell precache) | ✅ | `vite.config.ts` → `VitePWA({ registerType: "autoUpdate", workbox: { globPatterns: ["**/*.{js,css,html,svg,png,woff2}"] } })` |
| Offline SPA navigation fallback (`/dashboard` cold-open offline renders the shell) | ✅ | `vite.config.ts` → `navigateFallback: "index.html"`, `navigateFallbackDenylist: [/^\/api\//]` |
| Runtime caching: API GETs NetworkFirst (6s timeout, 200-entry/7-day expiration) | ✅ | `vite.config.ts` → `runtimeCaching[0]` (`api-get-cache`) |
| Runtime caching: fonts (SWR + CacheFirst), OSM map tiles (CacheFirst, 256 entries/30d) | ✅ | `vite.config.ts` → `runtimeCaching[1..3]` |
| SW registration + offline-ready callback + hourly update poll | ✅ | `src/main.tsx` → `registerSW({ immediate, onOfflineReady, onRegisteredSW })` |
| Install prompt capture (beforeinstallprompt → custom "Install Meridian" sidebar button) | ✅ | `src/hooks/use-pwa.ts` → `useInstallPrompt`; consumed in `src/components/Layout.tsx` (`canInstall && <button>…t.layout.installApp`) |
| Online/offline indicator chip in topbar | ✅ | `src/hooks/use-pwa.ts` → `useOnlineStatus`; rendered in `Layout.tsx` (`!online && … t.layout.offlineCached`) — verified working, drives chip on `offline` event |
| Offline empty state instead of infinite spinner on heavy queries | ✅ | `src/lib/OfflineBoundary.tsx`, applied on `src/pages/Dashboard.tsx` (KPI row) and `src/pages/Opportunities.tsx` (ranking list) |
| Safe-area insets for notched phones (bottom nav, topbar) | ✅ | `src/index.css` → `env(safe-area-inset-{top,bottom,left,right})`, `.pb-safe` used by `Layout.tsx` bottom nav |
| Mobile bottom navigation (<768px) + tablet overlay sidebar | ✅ | `src/components/Layout.tsx` → `BottomNav`, overlay `<aside>` |
| Copilot offline degradation (cached conversations readable, composer disabled) | ✅ | `src/pages/Copilot.tsx` (`!online` notices), `src/components/copilot/Composer.tsx` |
| Field-data offline queue (innovation) | ✅ | `src/pages/innovations/FieldData.tsx` (local queue, auto-sync on reconnect) |
| Automated smoke tests | ✅ | `src/__tests__/pwa.test.ts` (jsdom) — manifest parse/fields, workbox config (precache + NetworkFirst + fallback), `registerSW` in `main.tsx`, install-prompt hook, safe-area CSS, OfflineBoundary wiring |

## 2. Lighthouse PWA runbook (exact steps)

1. Build and serve the production bundle (SW only registers on a real build):
   ```bash
   npm run build
   npx serve dist/public        # or: npm run start, if configured
   ```
2. Open Chrome (desktop) → navigate to `http://localhost:<port>/dashboard`.
3. DevTools → **Lighthouse** tab → Categories: check **PWA** (plus
   Performance/Accessibility/Best Practices for the full picture) → Device:
   Mobile → **Analyze page load**.
4. Expected PWA category results:
   - "Installable" ✅ (manifest + SW + icons incl. maskable 512).
   - "Works offline" ✅ — start_url responds 200 when offline
     (navigateFallback → precached `index.html`).
   - "Themed address bar" ✅ (`theme_color` + `<meta name="theme-color">`).
5. Manual offline spot-check: DevTools → **Application → Service Workers** →
   check "Offline" → reload `/dashboard`. The app shell renders from precache;
   the topbar shows the "Offline — showing cached data" chip; API widgets show
   cached react-query data where present, otherwise the `OfflineBoundary`
   empty state (no infinite spinners).
6. Cache inspection: **Application → Cache Storage** should list
   `workbox-precache-v2-…` (app shell), `api-get-cache`, `map-tiles`,
   `google-fonts-*`.

## 3. Install instructions

- **Android (Chrome/Edge):** open the deployed URL → browser shows the
  install banner, or use the in-app **"Install Meridian"** sidebar entry
  (appears once `beforeinstallprompt` fires) → confirm. The app launches
  standalone with the maskable icon.
- **iOS (Safari):** open the URL → Share → **Add to Home Screen**. iOS uses
  the apple-touch icon/meta in `index.html`; standalone display and safe-area
  padding are handled by `viewport-fit=cover` + `env(safe-area-inset-*)`.
- **Desktop (Chrome/Edge):** click the install icon in the address bar, or
  the in-app install button → the app opens in its own window and appears in
  the OS app list.

## 4. Offline behavior matrix

| Capability | Offline behavior |
| --- | --- |
| App shell (HTML/JS/CSS/fonts/icons) | ✅ Works — precached by Workbox; cold navigation to any route falls back to `index.html` |
| Previously fetched API GETs (tRPC) | ✅ Served from `api-get-cache` (NetworkFirst, 6 s timeout, 7-day retention) |
| Visited pages with cached data | ✅ Render with data + "Offline — showing cached data" chip |
| Unvisited heavy views with no cached data | ⚠️ Degraded — designed offline empty state (`OfflineBoundary`) with retry, no infinite spinner |
| Copilot answers (live LLM retrieval) | ❌ Degraded — requires connectivity; cached conversations stay readable, composer shows offline hint |
| Legislation dependency graph | ⚠️ Degraded — last good snapshot kept in memory (`graphSnapshot` in `Legislation.tsx`) |
| Map tiles (OSM choropleth) | ⚠️ Degraded — tiles beyond the 256-entry/30-day cache are unavailable; derived SVG grid fallback renders |
| Field-data capture | ✅ Queue locally without connectivity, auto-sync on reconnect (`FieldData.tsx`) |
| Mutations (approve, sign-off, generate) | ❌ Blocked — require the API; actions surface an error toast instead of silently failing |

## 5. Capacitor relationship (MOB-1)

The native shell **consumes exactly this PWA build** — there is one web
codebase and one build artifact:

- `mobile/capacitor.config.ts` points `webDir` at the root build output
  (`../dist`), so `npm run build` in the root produces everything the native
  wrappers wrap.
- `mobile/README.md` documents the self-contained Capacitor workspace
  (Android/iOS regeneration, signing, icons) and explicitly guarantees the
  wrapper modifies nothing outside `mobile/`.
- Because the native shell is a WebView over the same build, the offline
  matrix above applies verbatim inside the native apps; the service worker is
  registered by the same `src/main.tsx` code path.
