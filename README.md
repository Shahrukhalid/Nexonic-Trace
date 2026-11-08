# NEXONIC TRACE

**Discover Your Digital Footprint.**

By Nexonic Technologies

Nexonic Trace is a local-first public-profile discovery application for Windows, macOS, and Android. No Nexonic account, hosted backend, subscription, or AI service is needed for core discovery.

**Early development — v0.1.0.** This is a working application foundation, not a production release or a complete exposure assessment.

## Available in this build

- React/TypeScript interface inside a Tauri 2 native shell, with desktop and mobile layouts, keyboard navigation, and light/dark themes.
- Shared Rust engine with two initial public-API connectors: GitHub and DEV Community.
- Concurrent, time-bounded requests; progressive results; cancellation; fixed HTTPS destinations; refused redirects; bounded response bodies; no automatic retries or access bypasses.
- Verification using matching usernames, numeric IDs, and provider-specific profile data. HTTP 200 alone does not confirm a profile. Account existence never establishes identity ownership.
- Result filters, evidence details, source links, and redacted JSON/CSV session reports.
- Session-only results and deletion controls. Only appearance is persisted. No credentials or search history are saved.

All three search modes currently check the same two sources. Connector coverage is preliminary, with deterministic regression tests and limited live smoke checks; this is not broad accuracy certification.

Email discovery, breach intelligence, password exposure, personal-information association, SQLite history, PDF/HTML reports, automatic rule updates, and release packages are not implemented yet. Their interface sections explain availability and do not generate findings. Browser preview never performs discovery; search execution requires the native app.

## Develop

Install Node.js 24 LTS, a current stable Rust toolchain, and [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). Windows needs Microsoft C++ Build Tools and WebView2. macOS needs Xcode Command Line Tools. Android additionally needs the Android SDK, NDK, JDK, and Rust Android targets.

```sh
npm ci
npm run tauri dev
```

Interface-only browser preview: `npm run dev`.

Checks:

```sh
npm run check
npx playwright install chromium
npm run test:ui
npm run build
cargo fmt --all --check
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
```

Explicit live connector probe (makes two public API requests; do not run repeatedly):

```sh
cargo run -p trace-core --example probe -- octocat
```

## Structure

- `src/`: interface, typed IPC adapter, report utilities.
- `crates/trace-core/`: reusable Rust discovery and verification engine.
- `src-tauri/`: desktop/mobile entry point and narrow native commands.
- `tests/`: deterministic frontend tests and responsive browser smoke tests.
- `.github/workflows/ci.yml`: frontend, UI, Rust, and native compilation checks on macOS and Windows.

Android shares the Rust entry point and responsive interface, but its generated native project and device validation are pending. Linux and iOS application targets are outside this project's scope.

## Privacy and responsible use

Only inspect public information you are permitted to access. Searches send the supplied username to each checked source. No page or source result proves that profiles belong to the same person. Requests do not use login, signup, recovery, CAPTCHA bypass, or credential enumeration. Reports can contain public personal information; choose redaction when sharing.

## Distribution status

Windows installers and portable packages, macOS DMGs and portable bundles for both architectures, and Android APKs are pending packaging and platform verification. Production signing/notarization credentials are not configured. No production release has been published.

Original code: [MIT](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md), [contributing](CONTRIBUTING.md), and [security policy](SECURITY.md).
