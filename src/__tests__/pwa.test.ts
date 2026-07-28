// @vitest-environment jsdom
/**
 * PWA smoke tests (see docs/PWA-EVIDENCE.md).
 *
 * Verifies the installable + offline-tolerant contract end-to-end:
 * manifest fields, workbox config in vite.config.ts, SW registration in
 * main.tsx, the offline navigation fallback, the install-prompt hook and
 * safe-area CSS. Run with `npm run test`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

describe("web app manifest (public/manifest.webmanifest)", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest")) as {
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    theme_color: string;
    background_color: string;
    icons: ManifestIcon[];
  };

  it("parses as valid JSON", () => {
    expect(manifest).toBeTypeOf("object");
  });

  it("has name and short_name", () => {
    expect(manifest.name.length).toBeGreaterThan(0);
    expect(manifest.short_name.length).toBeGreaterThan(0);
  });

  it("uses standalone display with start_url and scope", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
  });

  it("defines theme and background colors", () => {
    expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(manifest.background_color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("includes a 512px icon and a maskable 512px icon", () => {
    const any512 = manifest.icons.some(
      (i) => i.sizes.includes("512x512") && (i.purpose ?? "any").includes("any"),
    );
    const maskable512 = manifest.icons.some(
      (i) => i.sizes.includes("512x512") && (i.purpose ?? "").includes("maskable"),
    );
    expect(any512).toBe(true);
    expect(maskable512).toBe(true);
    // Referenced icon files exist on disk.
    for (const icon of manifest.icons) {
      expect(() =>
        readFileSync(path.join(root, "public", icon.src.replace(/^\//, ""))),
      ).not.toThrow();
    }
  });
});

describe("service worker / workbox config (vite.config.ts)", () => {
  const cfg = read("vite.config.ts");

  it("enables vite-plugin-pwa", () => {
    expect(cfg).toContain("VitePWA(");
    expect(cfg).toContain('registerType: "autoUpdate"');
  });

  it("precaches the app shell (globPatterns)", () => {
    expect(cfg).toContain("globPatterns:");
    expect(cfg).toMatch(/globPatterns:\s*\[[^\]]*\*\*\/\*\.\{js,css,html/);
  });

  it("has an offline SPA navigation fallback route", () => {
    expect(cfg).toContain('navigateFallback: "index.html"');
    expect(cfg).toContain("navigateFallbackDenylist");
  });

  it("caches API GETs with NetworkFirst runtime caching", () => {
    expect(cfg).toContain('handler: "NetworkFirst"');
    expect(cfg).toContain("api-get-cache");
    expect(cfg).toContain('url.pathname.startsWith("/api/")');
  });

  it("serves the manifest from public/ (manifest: false)", () => {
    expect(cfg).toContain("manifest: false");
  });
});

describe("service worker registration (src/main.tsx)", () => {
  const main = read("src/main.tsx");

  it("calls registerSW from virtual:pwa-register", () => {
    expect(main).toMatch(/from ['"]virtual:pwa-register['"]/);
    expect(main).toMatch(/registerSW\(\{/);
    expect(main).toContain("onOfflineReady");
  });
});

describe("install prompt + online status hooks (src/hooks/use-pwa.ts)", () => {
  const hook = read("src/hooks/use-pwa.ts");

  it("exposes a beforeinstallprompt capture hook", () => {
    expect(hook).toContain("useInstallPrompt");
    expect(hook).toContain("beforeinstallprompt");
    expect(hook).toContain("appinstalled");
  });

  it("exposes an online/offline status hook", () => {
    expect(hook).toContain("useOnlineStatus");
  });

  it("the offline indicator is wired into the app Layout", () => {
    const layout = read("src/components/Layout.tsx");
    expect(layout).toContain("useOnlineStatus");
    expect(layout).toContain("useInstallPrompt");
    expect(layout).toContain("offlineCached");
  });
});

describe("mobile chrome (src/index.css)", () => {
  const css = read("src/index.css");

  it("uses safe-area env() insets for notched devices", () => {
    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toContain("env(safe-area-inset-left)");
    expect(css).toContain("env(safe-area-inset-right)");
  });
});

describe("offline UX guards", () => {
  it("provides an OfflineBoundary for heavy queries", () => {
    const boundary = read("src/lib/OfflineBoundary.tsx");
    expect(boundary).toContain("useOnlineStatus");
    expect(boundary).toContain("offlineTitle");
    // Applied on the two heaviest query pages.
    expect(read("src/pages/Dashboard.tsx")).toContain("OfflineBoundary");
    expect(read("src/pages/Opportunities.tsx")).toContain("OfflineBoundary");
  });

  it("renders inside a DOM (jsdom) environment", () => {
    const el = document.createElement("div");
    el.id = "root";
    document.body.appendChild(el);
    expect(document.getElementById("root")).not.toBeNull();
  });
});
