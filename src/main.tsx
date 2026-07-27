import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
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

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
)
