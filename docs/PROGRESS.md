# Development status

The simplified app and all development packaging milestones are merged through PRs #1, #9–#14. [v0.1.0-dev.3](https://github.com/Shahrukhalid/Nexonic-Trace/releases/tag/v0.1.0-dev.3) was published from commit `75f2631` after the [complete release workflow passed](https://github.com/Shahrukhalid/Nexonic-Trace/actions/runs/42480723048). Its eight downloadable packages independently match the published SHA-256 checksums and validation records.

- M0–M1: protected required checks, original branding, minimal desktop/mobile navigation, compact evidence, keyboard controls and light/dark themes.
- M2–M4: five fixed official public APIs, versioned rules, conservative verification, 2/4/5-source scopes, bounded responses/concurrency, pacing, retry and cancellation. Limited live positive/missing-account probes passed on 2026-11-08. Matching usernames never establish ownership.
- M5–M7: optional licensed Brave public search, authorized HIBP verified/non-sensitive breach lookup, explicit provider cost consent, session-only keys and password-prefix checks without password/hash storage. Public official Pwned Passwords and HIBP integration fixtures passed. Live positive Brave acceptance still requires a licensed key.
- M8–M9: selected public fields without identity linkage, opt-in SQLite history, five recent searches, 100-scan retention, reopening/comparison/deletion and redacted JSON/CSV/HTML/PDF export. Internal PDF layout/source-link checks passed.
- M10: Rust, frontend/report, responsive interaction, format/type/build, dependency advisory, secret and license checks run in CI. Unrelated Linux lockfile findings are disclosed in SECURITY-AUDIT.md. The continuation adds regression coverage for startup-settings recovery, task-scoped disk cleanup and release provenance/inventory.
- M11: hosted Windows installer/portable execution, native Apple Silicon and Intel Mac launch/restart/IPC/deletion, and Android emulator/instrumentation acceptance passed for dev.3. ARM64/ARM32 APK signatures, architecture, bundled notices and 16 KiB alignment were verified. Android UI execution in hosted CI uses an x86_64 emulator; it does not claim physical ARM32 device acceptance.
- M12: validated development release automation publishes exactly eight binary assets, four validation records and SHA-256 checksums. Production tags fail closed.

## Continuation after dev.3

The pending frontend/toolchain and Rust-cache dependency updates are combined for compatibility testing. Packaging now requires the compiler's actual `COPYRIGHT-library.html`, records the source commit and Android test ABI, rejects mixed-commit or unexpected payloads, and limits disk cleanup to images under this build's output directory. These changes supersede dev.3's packaging once the continuation passes every required hosted gate and a new development tag publishes.

The most recent main run after dev.3 failed when its Android emulator disconnected during instrumentation. Another dependency run exposed a Settings startup read that never completed. The continuation adds read-only recovery without enabling history or writing fallback settings, plus diagnostic capture for native test failures. All native gates remain mandatory.

Production distribution remains blocked by absent protected signing credentials and production acceptance. Windows development files are unsigned; Mac files use ad-hoc signing without notarization; Android uses development certificates. No production release or independent security certification is claimed.

Comparison-project research was completed once; no third-party application source or detection database was copied. Linux/iOS apps and invasive/private-account enumeration are outside scope.
