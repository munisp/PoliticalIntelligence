#!/usr/bin/env node
/**
 * generate-icons.mjs — rasterize icons/icon.svg + icons/splash.svg into the
 * PNG sources expected by @capacitor/assets, then invoke @capacitor/assets to
 * populate every Android mipmap / iOS AppIcon slot.
 *
 * Two supported paths (documented in mobile/README.md § Icons):
 *
 *   A. Documented path — @capacitor/assets (recommended):
 *        npm install                 # devDeps include @capacitor/assets + sharp
 *        npm run icons
 *      This rasterizes the SVG sources (via sharp) into ./assets/*.png and
 *      then runs `capacitor-assets generate` against the generated projects.
 *
 *   B. Pure fallback — no image dependencies at all:
 *      If sharp is unavailable the script exits with the exact commands to
 *      run manually; you can also export the SVGs to PNG in any editor
 *      (1024×1024 icon, 2732×2732 splash), drop them into ./assets/ and run
 *      `npx capacitor-assets generate --assetPath assets`.
 *
 * Run AFTER `npx cap add android` / `npx cap add ios` so the native projects
 * exist for @capacitor/assets to write into. Safe to re-run.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const MOBILE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS_DIR = join(MOBILE_DIR, 'icons');
const ASSETS_DIR = join(MOBILE_DIR, 'assets');

const ICON_SVG = join(ICONS_DIR, 'icon.svg');
const SPLASH_SVG = join(ICONS_DIR, 'splash.svg');

const THEME_COLOR = '#0f172a';

/** Sizes required by @capacitor/assets conventions. */
const RASTER_TARGETS = [
  { src: ICON_SVG, out: 'icon-only.png', size: 1024, background: THEME_COLOR },
  { src: ICON_SVG, out: 'icon-foreground.png', size: 1024, background: THEME_COLOR },
  { src: ICON_SVG, out: 'icon-background.png', size: 1024, background: THEME_COLOR },
  { src: SPLASH_SVG, out: 'splash.png', size: 2732, background: THEME_COLOR },
  { src: SPLASH_SVG, out: 'splash-dark.png', size: 2732, background: THEME_COLOR },
];

function log(msg) {
  process.stdout.write(`[icons] ${msg}\n`);
}

async function rasterizeWithSharp() {
  let sharp;
  try {
    ({ default: sharp } = await import('sharp'));
  } catch {
    return false;
  }

  mkdirSync(ASSETS_DIR, { recursive: true });
  for (const target of RASTER_TARGETS) {
    const out = join(ASSETS_DIR, target.out);
    await sharp(target.src, { density: 384 })
      .resize(target.size, target.size, { fit: 'contain', background: target.background })
      .flatten({ background: target.background })
      .png()
      .toFile(out);
    log(`rasterized ${target.out} (${target.size}x${target.size})`);
  }
  return true;
}

function haveAllPngSources() {
  return RASTER_TARGETS.every((t) => existsSync(join(ASSETS_DIR, t.out)));
}

function runCapacitorAssets() {
  // Prefer the local devDependency; fall back to npx resolution.
  const result = spawnSync(
    'npx',
    ['--yes', 'capacitor-assets', 'generate', '--assetPath', ASSETS_DIR],
    { cwd: MOBILE_DIR, stdio: 'inherit' },
  );
  return result.status === 0;
}

function printManualFallback() {
  log('sharp is not installed — using the pure fallback path.');
  log('');
  log('1. Export the SVG sources to PNG (any editor: Inkscape, Figma, Preview):');
  for (const t of RASTER_TARGETS) {
    log(`     ${t.src.split('/').pop()} -> assets/${t.out}  ${t.size}x${t.size}, background ${t.background}`);
  }
  log('2. Generate native assets:');
  log('     npx @capacitor/assets generate --assetPath assets');
  log('');
  log('Or simply install the documented toolchain and re-run:');
  log('     npm install --save-dev sharp @capacitor/assets && npm run icons');
}

async function main() {
  for (const svg of [ICON_SVG, SPLASH_SVG]) {
    if (!existsSync(svg)) {
      log(`ERROR: missing source ${svg}`);
      process.exit(1);
    }
  }

  const rasterized = await rasterizeWithSharp();
  if (!rasterized && !haveAllPngSources()) {
    printManualFallback();
    process.exit(0); // documented no-op path, not a failure
  }

  if (runCapacitorAssets()) {
    log('done — Android mipmap-* and iOS Assets.xcassets updated.');
    log('re-run `npx cap sync` if the native projects were already open.');
  } else {
    log('@capacitor/assets CLI not available. Install it and re-run:');
    log('  npm install --save-dev @capacitor/assets && npm run icons');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[icons] failed:', error);
  process.exit(1);
});
