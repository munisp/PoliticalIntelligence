import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for the Policy Twin native wrapper.
 *
 * The web app is built by the ROOT package (`npm run build` at the repo root,
 * Vite output → `../dist` relative to this file). Capacitor only wraps that
 * static output in a native WebView shell — nothing in the root app is aware
 * of, or coupled to, this directory.
 */
const config: CapacitorConfig = {
  appId: 'gov.policytwin.platform',
  appName: 'Policy Twin',

  // Vite build output of the root React app (repo root runs `vite build`).
  // If the root app ever changes `build.outDir`, update this path to match,
  // otherwise the app will boot to a white screen.
  webDir: '../dist',

  // Capacitor >= 6 always bundles the runtime from @capacitor/core — the old
  // `bundledWebRuntime` flag was removed. Declared here explicitly for clarity
  // during migrations from Capacitor 5; the CLI ignores unknown keys.
  // (Cast below keeps this literal type-checkable on @capacitor/cli v7.)
  bundledWebRuntime: false,

  android: {
    // Never allow cleartext HTTP inside the WebView. All API traffic must be
    // HTTPS — a hard requirement for public-sector deployments.
    allowMixedContent: false,
  },

  ios: {
    // Let WKWebView manage safe-area insets automatically so the status bar
    // and home indicator never overlap dashboard content.
    contentInset: 'automatic',
  },

  // ── Live-reload development server (COMMENTED OUT for production) ──────────
  // To develop against the Vite dev server with hot reload on a device:
  //   1. Run `npm run dev` at the repo root (Vite listens on port 3000).
  //   2. Uncomment the block below and set `url` to your machine's LAN IP.
  //   3. `npx cap sync` then launch from Android Studio / Xcode.
  //   4. RE-COMMENT before any release build — shipped apps must load the
  //      bundled webDir assets, not a dev server.
  // server: {
  //   url: 'http://192.168.1.10:3000',
  //   cleartext: true, // local dev only; never ship with cleartext enabled
  // },

  plugins: {
    SplashScreen: {
      // Dark slate background matching the web app's theme so there is no
      // white flash between the native splash and the first rendered frame.
      launchShowDuration: 0,
      launchAutoHide: true,
      launchFadeOutDuration: 200,
      backgroundColor: '#0f172a',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      // Light (white) foreground icons/text over the dark slate theme.
      style: 'DARK',
      backgroundColor: '#0f172a',
      overlaysWebView: false,
    },
    PushNotifications: {
      // Icon resource in android/app/src/main/res/drawable used for the
      // notification tray. Created by icons/generate-icons.mjs.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
} as CapacitorConfig;

export default config;
