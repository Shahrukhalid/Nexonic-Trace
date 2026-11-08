# NEXONIC TRACE

**Discover Your Digital Footprint.**

By Nexonic Technologies

A local-first public-profile discovery and exposure-checking application for Windows, macOS, and Android. Core username searches and password checks need no Nexonic account, hosted backend, subscription, or AI service.

## Features

- Minimal React/TypeScript interface with light/dark themes, compact evidence cards, keyboard controls, and touch navigation.
- Five official public-API connectors: GitHub, DEV Community, Codeberg, Lichess, and Chess.com. Quick/Deep/Comprehensive searches check 2/4/5 sources.
- Two-worker concurrency, global and per-domain pacing, timeouts, one controlled transient retry, cancellation, and completed/failed/blocked/skipped outcomes.
- Structured profile verification with positive and negative signals. HTTP 200 alone never confirms an account. Matching usernames never establish shared ownership.
- Optional Brave Search integration for public mentions of usernames or email addresses. Indexed mentions are explicitly unverified and never imply account registration. Quick/Deep/Comprehensive limits are 3/6/10 indexed results. Provider credentials and applicable plan charges are required.
- Optional Have I Been Pwned email-breach lookup with an authorized, licensed API key. Only verified, non-sensitive breach records are shown. The permission checkbox is an authorization statement, not ownership verification; protected records are excluded.
- Free Pwned Passwords checks: explicitly initiated, SHA-1 calculated locally, only five hash-prefix characters sent with padding requested, suffix comparison local. Passwords and complete hashes are never sent to providers, saved, logged, or exported. Sensitive Rust buffers are zeroized where practicable.
- Publicly disclosed names, descriptions, website links, and emails from confirmed profile payloads. Users select sources they independently verified as theirs; the app keeps records separate and makes no identity linkage.
- Opt-in SQLite history, original timestamps, reopening scans, same-query status comparisons, individual deletion, and Delete All Data. No raw pages are retained.
- JSON, CSV, HTML, and PDF report exports with redaction. HTML is escaped and contains no scripts/external resources; CSV neutralizes formula prefixes. PDF preserves unsupported Unicode using explicit code-point notation. Native Save dialogs support platform file destinations.

Provider keys are session-only and cleared when the app closes or data is deleted. They are never written to the local database. Provider plans must permit the user's intended requests, retention, and exports. Nexonic does not set provider prices.

## Coverage and limits

The versioned connector registry records allowed HTTPS endpoints, username syntax, detection signals, pacing, timeout, priority, reliability status, and last verification date. All five connectors passed limited positive/missing-account smoke checks on 2026-11-08. This is smoke validation, not a guarantee of broad accuracy or identity ownership. Rule changes ship with tested application updates; arbitrary remote rules are not loaded.

Only permitted public sources are checked. The app does not search the entire internet, bypass login/CAPTCHA/rate limits, or use signup, password-reset, or recovery flows. Searches disclose the supplied query to each selected source or optional provider. No analytics or Nexonic server upload is enabled.

Browser preview does not execute live searches or security checks. Native interaction, platform packaging, signing, and credentialed-provider acceptance must be assessed separately from browser tests. Production readiness is not claimed.

## Develop

Use Node.js 24 LTS, a current stable Rust toolchain, and [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). Windows requires Microsoft C++ Build Tools and WebView2; macOS requires Xcode Command Line Tools. Android needs the SDK, NDK, JDK, and Rust Android targets.

```sh
npm ci
npm run tauri dev
```

Interface-only preview: `npm run dev`.

```sh
npm run check
npx playwright install chromium
npm run test:ui
npm run build
cargo fmt --all --check
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
```

Explicit live smoke probes, using public test queries and official HIBP fixtures only:

```sh
cargo run -p trace-core --example probe -- thibault comprehensive
cargo run -p trace-core --example security_probe
```

The security probe uses a publicly documented integration-test key, not a real credential. Integration-test addresses are excluded from the application exposure UI.

## Local data and Windows portable mode

History is off by default. Normal application data uses the operating system's per-user application directory. To use Windows portable mode, place `portable.txt` beside the executable in a writable directory. Ordinary preferences and optional SQLite history then use `NexonicTraceData` beside the application. Provider keys remain session-only. WebView2 is an operating system runtime prerequisite; portability does not remove that requirement.

Delete All Data removes saved scans, ordinary preferences, in-memory provider keys, and current session results. Optional history contains public personal information; choose a private folder and use redaction before sharing reports.

## Distribution

Development build status and remaining platform/signing blockers are recorded in `docs/PROGRESS.md`. Production certificates, notarization credentials, and Android release keys must be supplied through protected CI secrets and never committed. Development artifacts must be clearly labeled; no signing or production-readiness claims are made without successful verification. Linux and iOS applications are outside scope.

Original code: [MIT](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md), [contributing](CONTRIBUTING.md), and [security policy](SECURITY.md).
