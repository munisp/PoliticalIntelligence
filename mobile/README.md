# Policy Twin — Mobile (Capacitor Android & iOS wrapper)

Native mobile packaging for the **Jurisdiction Economic Intelligence & Policy
Twin Platform**. This directory is a self-contained Capacitor workspace: it
wraps the production build of the root React/Vite PWA in native WebView
shells for Android and iOS. **Nothing outside `mobile/` is modified** — the
web app, its build, and its CI remain untouched, and the two can be released
independently.

```
mobile/
├── package.json            # Capacitor deps + all scripts (sync/build/open/icons)
├── capacitor.config.ts     # appId gov.policytwin.platform, webDir ../dist
├── tsconfig.json           # standalone typecheck for src/native.ts
├── src/native.ts           # typed optional bridge (status bar, network, share, push…)
├── icons/
│   ├── icon.svg            # shield/globe mark, dark slate + amber
│   ├── splash.svg          # same motif, 2732×2732
│   └── generate-icons.mjs  # rasterize + @capacitor/assets driver
├── android/
│   ├── README.md           # exact regeneration steps, signing, icons, fastlane
│   ├── app/src/main/res/values/strings.xml   # app_name reference
│   └── manifest-additions.xml                # permission reference snippet
└── ios/
    └── README.md           # exact regeneration steps, signing, ATS, deep links
```

> The generated `android/` Gradle project and `ios/` Xcode project are
> intentionally **not committed**. Recreate them in minutes with
> `npm run add:android` / `npm run add:ios` (see platform READMEs).

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | **20+** | build + Capacitor CLI |
| Android Studio | Hedgehog (2023.1)+ | Android SDK 35, emulator, Gradle/JDK 17 |
| Xcode | **15+** (macOS only) | iOS build/signing |
| CocoaPods | latest | iOS plugin dependencies (`brew install cocoapods`) |

After `npm install`, run `npx cap doctor` — it validates the whole toolchain.

## First-time setup

```bash
# from the repo root
cd mobile
npm install

# Android
npm run add:android
npm run icons                 # launcher icons + splash (needs sharp, see § Icons)
npm run sync:android          # builds ../dist, copies assets & plugin config
npm run android               # opens Android Studio → Run

# iOS (macOS)
npm run add:ios
npm run icons
npm run sync:ios
npm run ios                   # opens Xcode workspace → select team → Run
```

## Everyday dev workflow

**Standard (bundled) loop** — edit the web app at the repo root, then:

```bash
cd mobile && npm run sync     # rebuild ../dist + copy into both native shells
```

**Live-reload loop** — develop on a real device against the Vite dev server:

1. At the repo root: `npm run dev` (Vite serves on port 3000).
2. In `capacitor.config.ts`, uncomment the `server` block and point `url` at
   your machine's LAN IP, e.g. `http://192.168.1.10:3000`.
3. `npx cap sync` and launch from Android Studio / Xcode.
4. **Re-comment the block before any release build** — shipped apps must load
   the bundled `webDir` assets. (The `cleartext: true` flag there is for the
   local dev server only.)

## Web ↔ native bridge (audit gap #9)

`src/main.tsx` (root app) wires `initNative` via a **guarded dynamic
import**: the bridge module is only imported when `window.Capacitor
?.isNativePlatform?.()` is true (native shell injects the Capacitor runtime
before web code runs). In a plain browser/PWA it is a strict no-op — the web
bundle never resolves `@capacitor/*` and no network fetch is attempted.

> **Native builds:** for the bridge code to actually bundle into the native
> app's WebView assets, add the `@capacitor/*` packages as root dev
> dependencies and change the non-literal import in `src/main.tsx` to the
> literal path `../../mobile/src/native` (Vite will then code-split it).
> Until then the dynamic import fails soft in the shell (warn-only) and all
> helpers in `src/native.ts` remain importable directly by native-targeted
> entry points.

## Quick sync + debug build

```bash
bash scripts/mobile-sync.sh            # web build + cap sync (both platforms)
bash scripts/mobile-sync.sh android    # android only
cd mobile/android && ./gradlew assembleDebug   # debug APK (needs Android SDK/JDK 17)
```

The sandbox/CI without an Android SDK cannot run `cap add`/`gradlew` — see
the commented `mobile-android` job sketch in `.github/workflows/ci.yml`.

## PWA ↔ native relationship

- The root app remains a fully functional PWA. Capacitor loads the **same**
  `vite build` output (`../dist`) inside WKWebView / Android System WebView.
- The app's service worker and Cache Storage **work unchanged inside the
  Capacitor WebView**, so the offline shell (previously viewed dashboards,
  cached indicator datasets) is available on-device with no extra work.
- **Offline / low-bandwidth behavior** (public-sector field requirement):
  - On cold start with no connectivity, the WebView boots the cached shell
    and the app should render its offline state rather than an error.
  - Use `getNetworkStatus()` / `onNetworkChange()` from `src/native.ts` to
    gate large sync jobs on metered connections and to drive an offline
    banner. Both fall back to `navigator.onLine` on web.
  - Never depend on a remote URL at boot: production config has no
    `server.url`, so the app always starts from local bundled assets.
- Native-only extras (share sheet, push, native splash/status bar) live in
  `src/native.ts` and are **optional**: every helper no-ops or degrades
  gracefully in the browser, so the root app can adopt them incrementally
  without breaking the PWA build.

## Build & release

### Android (Google Play)

```bash
npm run sync:android
npm run build:android:bundle   # → android/app/build/outputs/bundle/release/app-release.aab
```

1. Create the upload keystore and wire release signing exactly as described
   in `android/README.md` § 6 (`keytool` command + `build.gradle` snippet).
2. In Play Console, create the app (`gov.policytwin.platform`) and enroll in
   **Play App Signing** — Google holds the final signing key; your keystore
   is only the upload key. Store the keystore + passwords in the ministry's
   secrets vault, never in git.
3. Upload the AAB to the internal track, promote through closed/open testing,
   then production. Complete the Data Safety form (declare device IDs for
   push tokens; no personal data collected by default).

### iOS (App Store)

```bash
npm run sync:ios
npm run build:ios              # archives via xcodebuild, or Product → Archive in Xcode
```

1. Set the Apple Developer team in Xcode (see `ios/README.md` § 4).
2. Upload the archive via the Xcode Organizer to **App Store Connect**.
3. Complete screenshots, the privacy nutrition label (push device tokens,
   local UserDefaults session hints), and submit for App Review.

## Versioning strategy

Single source of truth: **`mobile/package.json → version`** (semver, e.g.
`1.4.0`). On every release:

| Platform field | Value |
|---|---|
| Android `versionName` | `mobile/package.json → version` |
| Android `versionCode` | monotonically increasing integer, bump **every** Play upload (suggested scheme: `major*10000 + minor*100 + patch`, e.g. 1.4.0 → 10400) |
| iOS `CFBundleShortVersionString` | `mobile/package.json → version` |
| iOS `CFBundleVersion` | build number, bump **every** App Store Connect upload (same scheme is fine) |

Set these in `android/app/build.gradle` (`defaultConfig`) and the Xcode
target's *General* tab after generating the native projects. Keep them in
lockstep with the root web app's release tag for support traceability
("app 1.4.0 = web release v1.4.0").

## Push notifications

Implemented in `registerPush()` (`src/native.ts`): requests permission,
registers, resolves the device token, and exposes configurable
received/action/error callbacks.

- **Android (FCM)**: place `google-services.json` from the Firebase console
  in `android/app/`, apply the Google Services plugin per Capacitor docs,
  and merge `POST_NOTIFICATIONS` from `android/manifest-additions.xml`.
  Send via FCM HTTP v1 with a service account.
- **iOS (APNs)**: enable the Push Notifications capability (see
  `ios/README.md` § 7) and issue an APNs Authentication Key for the
  notification service. Test on a physical device.
- Route notification payloads with deep links (below) so tapping an alert
  lands on the relevant dashboard.

## Deep links

- **Custom scheme**: `gov.policytwin.platform://<path>` works out of the box
  on both platforms (reverse-domain scheme from `capacitor.config.ts`).
- **Universal links / App Links** (recommended for email & push): configure
  Associated Domains on iOS (`applinks:app.policytwin.gov` + hosted AASA
  file, `ios/README.md` § 6) and verified `intent-filter` + hosted
  `assetlinks.json` on Android.
- In the web app, handle inbound URLs with
  `App.addListener('appUrlOpen', ({ url }) => …)` from `@capacitor/app` and
  route through React Router.

## Accessibility

- **Screen readers**: native shells add no chrome over the WebView, so
  VoiceOver/TalkBack drive the web app directly. Keep semantic HTML,
  labelled controls and live regions for dashboard updates in the web app —
  they map 1:1 to the native accessibility APIs.
- **Dynamic type / font scaling**: iOS WKWebView respects system text size
  via the `-apple-system-body` font and `text-size-adjust`; Android WebView
  follows the system font scale. Test dashboards at 130% text size.
- **Contrast**: the dark slate theme (`#0f172a` background, amber `#f59e0b`
  accents) targets WCAG AA for large text; verify chart palettes separately
  for color-vision deficiency (Recharts supports pattern fills).
- **Status bar**: `initNative()` sets light icons over the dark theme and
  disables WebView overlay so content never sits under the clock/notch.

## Icons & splash

Source artwork is SVG only (no binary assets committed):

- `icons/icon.svg` — 1024×1024 shield/globe mark.
- `icons/splash.svg` — 2732×2732 splash, same motif centered.

Generate all native slots:

```bash
npm run icons      # sharp rasterizes sources → assets/*.png, then
                   # @capacitor/assets fills android/mipmap-*, iOS Assets.xcassets
```

No image tooling available? The script prints the manual fallback (export
PNGs from any editor, run `npx capacitor-assets generate`). Adaptive icon
guidance (safe zone, background color) is in `android/README.md` § 7.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| White screen on launch | `webDir` mismatch — assets not built/copied | Run `npm run build:web` at repo root (Vite must output to root `dist/`), then `npx cap sync`. Confirm `capacitor.config.ts → webDir: '../dist'` still matches the root `build.outDir`. Check WebView console (`chrome://inspect` / Safari → Develop). |
| White screen only in release APK | `server.url` left in config from live-reload dev | Re-comment the `server` block, `npx cap sync`, rebuild. |
| "Cleartext HTTP traffic not permitted" (Android) | API call over plain HTTP | Point the API base URL at HTTPS. Never set `usesCleartextTraffic` or `allowMixedContent: true` — both are policy violations. |
| ATS errors / loads blocked (iOS) | Non-HTTPS endpoint or self-signed cert | Use a real certificate. Do not add `NSAllowsArbitraryLoads` exceptions. |
| Content under the status bar / notch | WebView overlaying system bars | Keep `StatusBar.setOverlaysWebView({ overlay: false })` (done in `initNative()`), `ios.contentInset: 'automatic'`, and use `env(safe-area-inset-*)` for edge-to-edge layouts. |
| Splash flashes white before app paints | Splash background ≠ app theme | `SplashScreen.backgroundColor` is `#0f172a` in config; regenerate splash PNGs with `npm run icons` if the native projects were created before the config existed. |
| Push permission never asked (Android 13+) | Missing `POST_NOTIFICATIONS` | Merge the line from `android/manifest-additions.xml` into `AndroidManifest.xml`. |
| `npx cap sync` says "web asset dir missing" | Root build not run / wrong CWD | Run commands from `mobile/`; the sync scripts build the root app first. |
| Gradle JDK errors | Wrong JDK | Use the JDK 17 bundled with Android Studio (Settings → Gradle → Gradle JDK). |
| CocoaPods failures (iOS) | Stale pods | `cd ios/App && pod install --repo-update` |

## Key files for reviewers

- `capacitor.config.ts` — identity, webDir, hardened WebView settings, plugin config.
- `src/native.ts` — typed bridge; every API documented and web-safe.
- `android/README.md` / `ios/README.md` — exact project regeneration, signing, store flows.
