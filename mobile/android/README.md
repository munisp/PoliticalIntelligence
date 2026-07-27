# Android native project — reproduction guide

The full Gradle project is **not committed** (it is generated and contains
machine-specific SDK paths). The only committed artifacts are the reference
resources under `app/src/main/res/values/` and `manifest-additions.xml`.
Regenerate the project exactly as follows.

## 1. Generate the project

```bash
cd mobile
npm install                 # installs @capacitor/cli + plugins (see package.json)
npm run build:web           # builds the root Vite app into ../dist
npm run add:android         # npx cap add android  → creates mobile/android/
npm run sync:android        # copies web assets + plugin config into android/
```

Requires: Node 20+, Android Studio (Hedgehog or newer), Android SDK 35,
JDK 17 (bundled with Android Studio). Verify with `npx cap doctor`.

## 2. Open and run

```bash
npm run android             # opens Android Studio
```

Select a device/emulator (API 23+) and press **Run**, or from the shell:

```bash
npm run run:android
```

## 3. SDK levels

`android/variables.gradle` after generation should read (adjust if the CLI
template drifts):

```gradle
ext {
    minSdkVersion = 23          // Android 6.0 — covers the government device fleet
    compileSdkVersion = 35      // current stable
    targetSdkVersion = 35
    androidxActivityVersion = '1.9.3'
    androidxAppCompatVersion = '1.7.0'
    ...
}
```

Capacitor 7 requires minSdk 23+; do not lower it.

## 4. App identity

- **applicationId**: `gov.policytwin.platform` (from `capacitor.config.ts`).
- **App name**: `app/src/main/res/values/strings.xml` (committed here as
  reference — `npx cap add android` generates the same file; keep `app_name`
  = `Policy Twin`). The generated `strings.xml` also contains
  `server_url`/`custom_url_scheme` keys — leave them untouched.

## 5. Permissions

Capacitor's default manifest requests **INTERNET only**. For push
notifications on Android 13+ merge in the `POST_NOTIFICATIONS` permission —
see `manifest-additions.xml` in this directory and copy the marked lines into
`android/app/src/main/AndroidManifest.xml`. Never add location/contact
permissions: the platform handles public economic data only.

## 6. Release signing (Play Console)

Generate an upload keystore (once, store it in the ministry's secrets vault,
NOT in git):

```bash
keytool -genkeypair -v \
  -keystore policy-twin-upload.keystore \
  -alias policy-twin-upload \
  -keyalg RSA -keysize 4096 -validity 10000
```

Then wire signing into `android/app/build.gradle`:

```gradle
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('keystore.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    ...
    signingConfigs {
        release {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile keystoreProperties['storeFile'] ? file(keystoreProperties['storeFile']) : null
            storePassword keystoreProperties['storePassword']
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false   // the JS bundle is already minified by Vite
        }
    }
}
```

Create `android/keystore.properties` (gitignored):

```properties
storeFile=../../policy-twin-upload.keystore
storePassword=<store password>
keyAlias=policy-twin-upload
keyPassword=<key password>
```

Build the release artifacts:

```bash
npm run sync:android
npm run build:android          # → android/app/build/outputs/apk/release/app-release.apk
npm run build:android:bundle   # → android/app/build/outputs/bundle/release/app-release.aab
```

Upload the **AAB** to Play Console and enroll in **Play App Signing**
(Google manages the final signing key; the keystore above is only the upload
key). In Play Console: *Setup → App integrity → App signing → Use Google
App Signing*. Set `versionName` from `mobile/package.json → version` and
increment `versionCode` for every upload (see `mobile/README.md` § Versioning).

## 7. Adaptive icon

Run `npm run icons` (or the documented `@capacitor/assets` path) to generate:

- `android/app/src/main/res/mipmap-*/ic_launcher.png` + `ic_launcher_round.png`
- `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` (adaptive icon)
- `android/app/src/main/res/values/colors.xml` with
  `ic_launcher_background = #0f172a`

The adaptive icon XML layers `ic_launcher_foreground` (the shield/globe
mark, ~66% of the canvas, inside the safe zone) over the dark slate
background color. Do not put text in the foreground layer — launchers crop
adaptive icons to circles/squircles at OEM discretion.

## 8. Splash screen

`capacitor.config.ts` sets `androidSplashResourceName: 'splash'` with a
`#0f172a` background. `npx cap add android` scaffolds
`app/src/main/res/drawable/splash.png`; replace it with the output of
`npm run icons` (2732×2732 source, density-scaled into
`drawable-port-*/splash.png` etc. by the generator).

## 9. Fastlane (optional automation)

If the program office wants CI uploads, initialize `fastlane init` inside
`android/`. A minimal lane:

```ruby
lane :release do
  gradle(task: 'bundleRelease')
  upload_to_play_console(track: 'internal', aab: 'app/build/outputs/bundle/release/app-release.aab')
end
```

Supply the Play Console service-account JSON via
`SUPPLY_JSON_KEY` and keep it out of git. Fastlane is optional — the manual
AAB upload flow above is fully supported.

## Troubleshooting

See `mobile/README.md` § Troubleshooting for white-screen, cleartext and
status-bar-overlap fixes.
