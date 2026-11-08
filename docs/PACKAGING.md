# Development packages and release gates

`.github/workflows/packages.yml` packages Windows x64, macOS Apple Silicon/Intel and Android ARM64/ARM32. Linux is used only as an Android/tooling runner, not as an application target. There is no iOS application target.

Every package includes a target-specific dependency catalog, original JavaScript/Rust/Android runtime license notices, canonical license texts, and checksum-verified exact source archives where required. Unknown licenses stop packaging. RustSec checks all supported dependency graphs, npm checks vulnerable packages, Gitleaks scans committed history, and Gradle validates its wrapper. See SECURITY-AUDIT.md for the disclosed lockfile-only findings.

The desktop debug test harness is compiled only in debug builds and remains disabled unless the explicit `NEXONIC_SMOKE_TEST=1` environment flag is supplied. It runs the actual app twice using disposable test data. It checks rendered navigation, Rust IPC, opt-in history preferences across restart, theme persistence, and deletion. Windows packaging additionally installs the per-user NSIS setup into a disposable directory, launches it, and launches the extracted portable app with data beside its executable. Generated test data is removed before archiving. Mac bundles are tested on native ARM64 and Intel runners and checked with codesign and hdiutil. Android is installed in an isolated emulator, tested through the actual WebView/Rust bridge and Android instrumentation, and checked for ABI, signatures, 16 KiB ELF/ZIP alignment and bundled notices.

Only tags matching `vMAJOR.MINOR.PATCH-dev.NUMBER` can publish today. All package and security jobs must pass before publication. The publisher verifies the exact eight expected binary assets against validation records, rejects unexpected binary payloads, and publishes SHA-256 checksums. Pull requests and main builds upload test artifacts without publishing a release.

These development packages are intentionally labeled: Windows unsigned, macOS ad-hoc signed without notarization, and Android signed with development certificates. Operating systems may block installation. Production tags fail closed. Protected production signing and its verification are still required before production publishing can be enabled; no production signing credentials are currently configured.

Future production signing must use protected GitHub environments and secrets: Windows code-signing certificate/password; Apple Developer ID certificate/password, Apple ID app-specific notarization credential and team ID; Android keystore/password/alias/key password. Never paste these into issues, PRs or source files. Require all three platform verification stages and production native acceptance before allowing a production tag. The Android Gradle source already reads release signing material only through environment variables. No signing material is committed.

## Local checks

Run the ordinary checks in README first. Generate notices with Python 3.11+ and an installed target toolchain, then build and package:

```sh
python3 scripts/notices.py --target aarch64-apple-darwin
CI=true APPLE_SIGNING_IDENTITY=- npm run tauri -- build --debug --bundles app,dmg --ci
python3 scripts/package_desktop.py
```

Use the Windows native target with `--bundles nsis` on Windows. Android requires `ANDROID_HOME`, `NDK_HOME` and Java 21. Initialize machine-local plugin paths with `npm run tauri -- android init --ci --skip-targets-install`, build the APKs, collect runtime notices using the Gradle task with configuration caching disabled, copy the generated notices to app assets, and rebuild. The workflow records the exact commands. Android packaging refuses to proceed without native and instrumentation acceptance evidence.
