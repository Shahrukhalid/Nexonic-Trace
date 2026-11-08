# Development status

The simplified app and development packaging are implemented. The latest validated downloads are listed in [GitHub Releases](https://github.com/Shahrukhalid/Nexonic-Trace/releases). An independent handoff audit confirmed that [v0.1.0-dev.3](https://github.com/Shahrukhalid/Nexonic-Trace/releases/tag/v0.1.0-dev.3) was published from commit `75f2631` after the [complete release workflow passed](https://github.com/Shahrukhalid/Nexonic-Trace/actions/runs/42480723048). Its eight downloadable packages independently match the published SHA-256 checksums and validation records.

- M0–M1: protected required checks, original branding, minimal desktop/mobile navigation, compact evidence, keyboard controls and light/dark themes.
- M2–M4: five fixed official public APIs, versioned rules, conservative verification, 2/4/5-source scopes, bounded responses/concurrency, pacing, retry and cancellation. Limited live positive/missing-account probes passed on 2026-11-08. Matching usernames never establish ownership.
- M5–M7: optional licensed Brave public search, authorized HIBP verified/non-sensitive breach lookup, explicit provider cost consent, session-only keys and password-prefix checks without password/hash storage. Public official Pwned Passwords and HIBP integration fixtures passed. Live positive Brave acceptance still requires a licensed key.
- M8–M9: selected public fields without identity linkage, opt-in SQLite history, five recent searches, 100-scan retention, reopening/comparison/deletion and redacted JSON/CSV/HTML/PDF export. Internal PDF layout/source-link checks passed.
- M10: Rust, frontend/report, responsive interaction, format/type/build, dependency advisory, secret and license checks run in CI. Unrelated Linux lockfile findings are disclosed in SECURITY-AUDIT.md. The continuation adds regression coverage for startup-settings recovery, task-scoped disk cleanup and release provenance/inventory.
- M11: hosted Windows installer/portable execution, native Apple Silicon and Intel Mac launch/restart/IPC/deletion, and Android emulator/instrumentation acceptance passed for dev.3. ARM64/ARM32 APK signatures, architecture, bundled notices and 16 KiB alignment were verified. Android UI execution in hosted CI uses an x86_64 emulator; it does not claim physical ARM32 device acceptance.
- M12: validated development release automation publishes exactly eight binary assets, four validation records and SHA-256 checksums. Production tags fail closed.

## Continuation after dev.3

The frontend/toolchain and Rust-cache dependency updates are combined for compatibility across the native platforms. Packaging now requires the compiler's actual `COPYRIGHT-library.html`, records the source commit and Android test ABI, rejects mixed-commit or unexpected payloads, and limits disk cleanup to images under this build's output directory. Every updated development release must pass all nine required hosted checks before its assets can publish. Updated validation records tie every package to that release's exact source commit.

Startup-settings recovery retries only local reads, remains disabled on persistent failures, offers an explicit reload control, and cancels pending reads during deletion. It never enables history or writes fallback settings in response to a read failure. Native Android failures preserve screenshots and instrumentation evidence; all native acceptance gates remain mandatory.

Current local regression suite: 27 Rust tests, 12 frontend/report/startup tests, 22 desktop/mobile interaction tests and ten packaging/provenance tests. Type/build, format, dependency audits and actual Apple Silicon package acceptance pass. Hosted jobs independently validate Windows, both Mac architectures and the Android emulator for each commit.

Production distribution remains blocked by absent protected signing credentials and production acceptance. Windows development files are unsigned; Mac files use ad-hoc signing without notarization; Android uses development certificates. No production release or independent security certification is claimed.

Comparison-project research was completed once; no third-party application source or detection database was copied. Linux/iOS apps and invasive/private-account enumeration are outside scope.
