#!/usr/bin/env bash
# mobile-sync.sh — one-shot web build + Capacitor sync (audit gap #9).
#
# Usage:
#   bash scripts/mobile-sync.sh [android|ios]   # default: both
#
# Prereqs: `cd mobile && npm install` once; native projects generated via
# `npm run add:android` / `npm run add:ios` (they are intentionally not
# committed — see mobile/README.md).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/mobile"

PLATFORM="${1:-all}"

echo "[mobile-sync] installing mobile deps (if needed)"
[ -d node_modules ] || npm install

echo "[mobile-sync] building web app (../dist)"
npm run build:web

case "$PLATFORM" in
  android) npx cap sync android ;;
  ios)     npx cap sync ios ;;
  all)     npx cap sync ;;
  *) echo "unknown platform: $PLATFORM (android|ios|all)" >&2; exit 2 ;;
esac

echo "[mobile-sync] done. Debug APK: cd mobile/android && ./gradlew assembleDebug"
