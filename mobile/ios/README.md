# iOS native project — reproduction guide

The full Xcode project is **not committed** (generated, contains local signing
and DerivedData paths). Regenerate it exactly as follows.

## 1. Generate the project

```bash
cd mobile
npm install                 # installs @capacitor/cli + plugins
npm run build:web           # builds the root Vite app into ../dist
npm run add:ios             # npx cap add ios → creates mobile/ios/
npm run sync:ios            # copies web assets + plugin config into ios/
```

Requires: macOS with **Xcode 15+**, CocoaPods (`sudo gem install cocoapods`
or `brew install cocoapods`), Node 20+. Verify with `npx cap doctor`.
`npx cap add ios` runs `pod install` automatically inside `ios/App/`.

## 2. Open and run

```bash
npm run ios                 # opens ios/App/App.xcworkspace in Xcode
```

> Always open the **.xcworkspace**, never the .xcodeproj — the workspace is
> what links the CocoaPods dependencies (Capacitor + plugins).

Select a simulator or device and press **Run**, or `npm run run:ios`.

## 3. App identity

- **Bundle Identifier**: `gov.policytwin.platform` (Xcode target *App* →
  *Signing & Capabilities*). Matches `appId` in `capacitor.config.ts`.
- **Display Name**: `Policy Twin` (auto-set from `appName`).
- **Version/Build**: set from `mobile/package.json → version`; bump the build
  number on every App Store Connect upload (see `mobile/README.md`
  § Versioning).

## 4. Signing

1. Xcode target *App* → *Signing & Capabilities* → enable
   **Automatically manage signing**.
2. Select the program office's **Apple Developer Program Team** (requires an
   active paid membership for device installs and distribution).
3. Xcode generates the provisioning profile against the bundle ID above.

For CI (`npm run build:ios`) set `DEVELOPMENT_TEAM` and
`CODE_SIGN_STYLE` via `ios/App/exportOptions.plist` or `xcodebuild` flags —
the committed script builds an archive using whatever signing Xcode resolves.

## 5. App Transport Security (ATS)

Keep ATS **fully enabled** (the Xcode default). The platform only calls the
HTTPS Policy Twin API, so no `NSAppTransportSecurity` exceptions belong in
`ios/App/App/Info.plist`. If a staging environment uses a self-signed
certificate, deploy a real certificate instead of adding
`NSAllowsArbitraryLoads` — App Review and public-sector security policy both
reject blanket ATS exceptions.

## 6. Deep links — custom scheme and universal links

- **Custom scheme**: the generated `Info.plist` registers the reverse-domain
  scheme `gov.policytwin.platform://` (from `custom_url_scheme`). Handle
  inbound URLs in the web app via `App.addListener('appUrlOpen', ...)`
  from `@capacitor/app`.
- **Universal links** (preferred for email/notification links):
  1. *Signing & Capabilities* → **+ Capability → Associated Domains**.
  2. Add `applinks:<your-domain>` (e.g. `applinks:app.policytwin.gov`).
  3. Host `/.well-known/apple-app-site-association` on that domain with the
     appID `<TEAM_ID>.gov.policytwin.platform` and the paths to open in-app.
  4. Validate with Apple's AASA validator and test from a real device —
     universal links do not fire in the simulator.

## 7. Push notifications (APNs)

1. *Signing & Capabilities* → **+ Capability → Push Notifications**.
2. Also add the **Background Modes** capability with *Remote notifications*
   if alerts should wake the app.
3. In the Apple Developer portal create an **APNs Authentication Key**
   (preferred over certificates) and hand it to the notification service.
4. Runtime flow is implemented in `registerPush()` (`mobile/src/native.ts`):
   it requests permission, registers with APNs, and returns the device token.
5. Test pushes on a **physical device** — APNs does not deliver to the
   simulator's production environment.

## 8. Status bar & safe area

`capacitor.config.ts` sets `ios.contentInset: 'automatic'` so WKWebView
adjusts for the notch, status bar and home indicator. The web app should
still use `env(safe-area-inset-*)` for edge-to-edge layouts; `initNative()`
in `mobile/src/native.ts` styles the status bar for the dark slate theme.

## 9. Icons & splash

Run `npm run icons` (or the documented `@capacitor/assets` path) to populate:

- `ios/App/App/Assets.xcassets/AppIcon.appiconset/` — all required sizes
  (Xcode 15 single 1024×1024 "single size" slot is supported).
- `ios/App/App/Assets.xcassets/Splash.imageset/` — 2732×2732 variants with
  the dark slate `#0f172a` background matching the launch storyboard
  (`SplashBackgroundColor` is already set by Capacitor from
  `capacitor.config.ts`).

## 10. App Store release

1. `npm run sync:ios`
2. In Xcode: *Product → Archive* (or `npm run build:ios`).
3. In the Organizer: **Distribute App → App Store Connect → Upload**.
4. In App Store Connect: complete screenshots (6.7" + 5.5"), the privacy
   nutrition label (declare device identifiers for push tokens and
   user-defaults storage of session hints), and submit for review.

## Troubleshooting

See `mobile/README.md` § Troubleshooting for white-screen, ATS/cleartext and
status-bar-overlap fixes.
