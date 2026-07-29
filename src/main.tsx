import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import { LocaleProvider } from "@/lib/LocaleContext"
import App from './App.tsx'

// Register the PWA service worker (app shell + runtime API caching, offline shell).
registerSW({
  immediate: true,
  onOfflineReady() {
    // App shell cached — offline-capable from this point.
    console.info('[pwa] Offline ready — app shell cached.')
  },
  onRegisteredSW(_swUrl, registration) {
    // Poll for updates hourly.
    if (registration) {
      setInterval(() => void registration.update(), 60 * 60 * 1000)
    }
  },
})

// Optional Capacitor native bridge (audit gap #9 — mobile/README.md).
// Dynamic, non-literal import so the web bundle neither resolves nor fetches
// `mobile/src/native.ts` (and its @capacitor/* deps) in a plain browser:
// the guard below only passes inside a native WebView shell, where the
// Capacitor runtime is injected by the platform before any web code runs.
// On web this is a strict no-op.
declare global {
  interface Window {
    Capacitor?: { isNativePlatform?: () => boolean }
  }
}
if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
  const nativeBridgeSpecifier = '../../mobile/src/native'
  import(/* @vite-ignore */ nativeBridgeSpecifier)
    .then((m) =>
      m.initNative({
        onResume: () => {
          // Native shell returned to foreground — let React Query's own
          // focus refetching pick up stale data (it listens to visibility).
          console.info('[native] resumed')
        },
      }),
    )
    .catch((err) => console.warn('[native] bridge unavailable:', err))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TRPCProvider>
        {/* I18N: locale provider (default English) — additive wrap. */}
        <LocaleProvider>
          <App />
        </LocaleProvider>
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>,
)
