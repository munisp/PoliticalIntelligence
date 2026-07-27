/**
 * native.ts — optional bridge between the Policy Twin web app and the
 * Capacitor native shell.
 *
 * USAGE (intentionally NOT wired into the root app by default):
 *   import { initNative, shareBrief } from '../../mobile/src/native';
 *
 *   // e.g. in src/main.tsx, before rendering:
 *   void initNative({
 *     onResume: () => queryClient.invalidateQueries(), // refresh stale data
 *   });
 *
 *   // e.g. from the Executive Brief screen's share/export action:
 *   void shareBrief({ title: brief.title, text: brief.summary, url: briefUrl });
 *
 * Every helper is a safe no-op (or web fallback) when the app runs in a plain
 * browser, so importing this module never breaks the PWA build.
 *
 * NOTE FOR THE ROOT BUILD: if the root app imports this file, its bundler
 * must be able to resolve the @capacitor/* packages. Add them as (dev)
 * dependencies of the ROOT package.json too, or alias this module behind a
 * dynamic import so it is tree-shaken out of the web bundle.
 */

import { Capacitor } from '@capacitor/core';
import { App, type BackButtonListenerEvent } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Network, type ConnectionStatus } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import {
  PushNotifications,
  type PushNotificationSchema,
  type ActionPerformed,
} from '@capacitor/push-notifications';

/** Dark slate theme color shared with capacitor.config.ts and the web app. */
export const NATIVE_THEME_COLOR = '#0f172a';

/** Prefix applied to every Preferences key written by this module. */
const PREF_KEY_PREFIX = 'policytwin.';

// ─────────────────────────────────────────────────────────────────────────────
// Platform detection
// ─────────────────────────────────────────────────────────────────────────────

/** True when running inside a Capacitor native shell (Android or iOS). */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** Current native platform, or 'web' when running in a browser/PWA. */
export function getPlatform(): 'android' | 'ios' | 'web' {
  const platform = Capacitor.getPlatform();
  return platform === 'android' || platform === 'ios' ? platform : 'web';
}

// ─────────────────────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────────────────────

export interface InitNativeOptions {
  /**
   * Called every time the app returns to the foreground. Wire this to your
   * data layer (e.g. invalidate stale React Query caches, revalidate
   * dashboard tiles) so ministers never see outdated figures after the app
   * sat in the background.
   */
  onResume?: () => void;
  /**
   * Called when the Android hardware/gesture back button is pressed at the
   * root of the navigation stack (nothing left to pop). Default behavior:
   * minimize the app instead of destroying the activity.
   */
  onBackAtRoot?: () => void;
  /** Hide the native splash screen. Default: true. */
  autoHideSplash?: boolean;
}

/**
 * One-time native shell setup: status bar theming, splash dismissal,
 * app-state resume handling, and Android back-button behavior.
 * Safe to call on web — it resolves immediately without side effects.
 */
export async function initNative(options: InitNativeOptions = {}): Promise<void> {
  if (!isNative()) return;

  const { onResume, onBackAtRoot, autoHideSplash = true } = options;

  // Status bar: light icons over the dark slate theme; WebView laid out
  // below the status bar (no overlap of dashboard content).
  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setStyle({ style: Style.Dark });
    if (getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: NATIVE_THEME_COLOR });
    }
  } catch (error) {
    console.warn('[native] StatusBar setup failed:', error);
  }

  // Resume hook: refresh stale data when the app is re-foregrounded.
  await App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) onResume?.();
  });

  // Android back button: navigate back through in-app history when possible;
  // otherwise minimize (public-sector users expect the session to persist).
  await App.addListener('backButton', (event: BackButtonListenerEvent) => {
    if (event.canGoBack) {
      window.history.back();
    } else if (onBackAtRoot) {
      onBackAtRoot();
    } else {
      void App.minimizeApp();
    }
  });

  if (autoHideSplash) {
    // Small delay lets the first React frame paint behind the splash so the
    // transition is visually seamless.
    setTimeout(() => {
      void SplashScreen.hide().catch(() => undefined);
    }, 150);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Network status (offline / low-bandwidth behavior)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Current connectivity status. On web, falls back to `navigator.onLine`.
 * Use this to gate expensive sync operations and to surface the platform's
 * offline-banner for field teams on unreliable connections.
 */
export async function getNetworkStatus(): Promise<ConnectionStatus> {
  if (!isNative()) {
    return {
      connected: navigator.onLine,
      connectionType: 'unknown',
    };
  }
  return Network.getStatus();
}

/**
 * Subscribe to connectivity changes. Returns an unsubscribe function.
 * Typical use: pause large dataset downloads when the connection drops to
 * cellular, and resume when Wi‑Fi returns.
 */
export function onNetworkChange(
  callback: (status: ConnectionStatus) => void,
): () => void {
  if (!isNative()) {
    const online = () =>
      callback({ connected: true, connectionType: 'unknown' });
    const offline = () =>
      callback({ connected: false, connectionType: 'none' });
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }

  const handlePromise = Network.addListener('networkStatusChange', callback);
  return () => {
    void handlePromise.then((handle) => handle.remove());
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Session hints via Preferences (secure-ish, persistent key-value storage)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persist a small non-secret session hint (last opened jurisdiction, selected
 * fiscal year, user display name) so the app can restore context instantly on
 * cold start without waiting for the API.
 *
 * Do NOT store access tokens or PII-heavy payloads here. On Android,
 * Preferences is backed by SharedPreferences (app-private); on iOS by
 * UserDefaults (app-private). Both survive app restarts but are wiped on
 * uninstall. Keys are namespaced with `policytwin.`.
 */
export async function secureSet(key: string, value: string): Promise<void> {
  await Preferences.set({ key: PREF_KEY_PREFIX + key, value });
}

/** Read a value previously written by {@link secureSet}. Null when absent. */
export async function secureGet(key: string): Promise<string | null> {
  const { value } = await Preferences.get({ key: PREF_KEY_PREFIX + key });
  return value;
}

/** Remove a value previously written by {@link secureSet}. */
export async function secureRemove(key: string): Promise<void> {
  await Preferences.remove({ key: PREF_KEY_PREFIX + key });
}

// ─────────────────────────────────────────────────────────────────────────────
// Share (Executive Brief export)
// ─────────────────────────────────────────────────────────────────────────────

export interface ShareBriefInput {
  /** Brief headline, used as the share sheet title / email subject. */
  title: string;
  /** Executive summary text. */
  text: string;
  /** Canonical URL of the brief in the web app, for recipients with access. */
  url?: string;
}

/**
 * Open the native share sheet — used by the Executive Brief screen's
 * share/export action. On native this is the OS share sheet; on web it uses
 * the Web Share API when available and resolves to false otherwise (caller
 * may then fall back to a copy-to-clipboard or download action).
 *
 * @returns true when the share sheet was presented, false otherwise.
 */
export async function shareBrief(input: ShareBriefInput): Promise<boolean> {
  const { title, text, url } = input;

  if (isNative()) {
    const result = await Share.share({
      title,
      text,
      url,
      dialogTitle: 'Share Executive Brief',
    });
    // activityType is present on iOS when the user picked a target; absence
    // on Android simply means the sheet completed.
    void result;
    return true;
  }

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      return true;
    } catch (error) {
      // User cancelled the share sheet — not an error condition.
      if ((error as DOMException).name === 'AbortError') return false;
      throw error;
    }
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Push notifications (FCM on Android, APNs on iOS)
// ─────────────────────────────────────────────────────────────────────────────

export interface PushHandlers {
  /** A push arrived while the app was in the foreground. */
  onReceived?: (notification: PushNotificationSchema) => void;
  /** The user tapped a push (cold start or background). */
  onAction?: (action: ActionPerformed) => void;
  /** Registration failed (no Play Services, APNs misconfiguration, ...). */
  onError?: (error: unknown) => void;
}

/**
 * Request push permission, register with FCM/APNs, and resolve with the
 * device token (null when permission is denied or registration fails).
 * Upload the returned token to the notification service so alerts (e.g.
 * "new economic indicators published for your jurisdiction") reach devices.
 *
 * Prerequisites — see mobile/README.md § Push notifications:
 *   Android: google-services.json in android/app/, POST_NOTIFICATIONS
 *            permission (API 33+).
 *   iOS:     Push Notifications capability + APNs key in App Store Connect.
 */
export async function registerPush(
  handlers: PushHandlers = {},
): Promise<string | null> {
  if (!isNative()) return null;

  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') {
    return null;
  }

  // Always-on notification listeners (foreground display + tap handling).
  await PushNotifications.addListener('pushNotificationReceived', (n) =>
    handlers.onReceived?.(n),
  );
  await PushNotifications.addListener('pushNotificationActionPerformed', (a) =>
    handlers.onAction?.(a),
  );

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const settle = (token: string | null) => {
      if (!settled) {
        settled = true;
        resolve(token);
      }
    };

    void PushNotifications.addListener('registration', (token) =>
      settle(token.value),
    );
    void PushNotifications.addListener('registrationError', (error) => {
      handlers.onError?.(error);
      settle(null);
    });

    void PushNotifications.register();
  });
}

/** Remove the device from the push provider (e.g. on sign-out). */
export async function unregisterPush(): Promise<void> {
  if (!isNative()) return;
  await PushNotifications.removeAllListeners();
  await PushNotifications.unregister();
}
