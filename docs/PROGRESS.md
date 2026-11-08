# Development status

The latest published, validated downloads are [v0.1.0-dev.4](https://github.com/Shahrukhalid/Nexonic-Trace/releases/tag/v0.1.0-dev.4), built from `3f7794e`. They include eight binaries, four source-linked validation records, SHA-256 checksums and runtime license notices. They are development packages, not trusted production releases.

## Implemented

- Minimal desktop/mobile workspace, light/dark themes, keyboard controls and compact expandable evidence.
- 30 live-verified public-profile APIs driven by declarative rules, with 10/20/30-source depths, bounded concurrency, pacing, timeouts, retry and cancellation. HTTP success alone never confirms an account or shared ownership.
- Visible Profiles / Web / Dark web areas. Brave public-web and licensed DarkOwl metadata discovery support usernames/emails with 20/60/100-result budgets, deduplication and paced pagination. Later-page failures and cancellation preserve partial results. See [coverage](SEARCH-COVERAGE.md).
- Authorized HIBP breach metadata; optional Pro stealer-log service domains require provider-verified domain control. Private Pwned Passwords checks send only a five-character hash prefix. No leaked document retrieval, plaintext password transmission, credential testing or inferred credential pairs.
- Session-only provider keys with cost consent, no app server/analytics, opt-in SQLite history, retention, recent/reopened searches, same-query/scope comparisons, deletion and redacted JSON/CSV/HTML/PDF exports. Dark-web exports start redacted. Startup reads recover from lost replies without re-enabling deleted preferences.
- Required security/license/build/UI/native checks for Windows, macOS Apple Silicon/Intel and Android. Notices include the compiler's actual Rust standard-library copyright file and required source archives. Unrelated Linux lockfile findings are disclosed in SECURITY-AUDIT.md without advisory waivers.
- Development release inventory requires all eight expected binaries and the same source commit for every platform. Native acceptance covers actual launch/IPC/persistence/deletion, Windows installer/portable mode, native Macs and an isolated Android emulator. Android ARM packages receive signature, manifest/content and 16 KiB alignment checks; physical ARM32 acceptance is not claimed.
- Protected production-signing environment, permanent pinned Android identity with an encrypted private backup outside the repository, owner-only immutable release tags, guarded candidate workflows, and actual optimized desktop startup verification. Publication remains disabled until all platforms pass signed acceptance together. See [signing setup and activation](PRODUCTION-SIGNING.md).

Current regression suite: 36 Rust tests, 13 frontend/report/startup tests, 32 desktop/mobile interaction tests and 19 signing/packaging/provenance tests. Local type/build, formatting, Clippy, supported-target advisory checks, license collection and actual optimized Apple Silicon startup passed. Hosted platform checks remain authoritative for each merged source commit.

## External requirements

The publisher has no Apple/Windows signing accounts and no licensed search-provider accounts yet. Trusted desktop signing, notarization and authenticated provider acceptance cannot be claimed until those accounts and protected credentials are supplied. Android signed-candidate acceptance runs separately through the protected workflow. An Android-only pass cannot activate all-platform production publishing. Public downloads remain clearly labeled development builds until complete production verification.

No search covers every internet page, private community or dark-web service. Comparison-project research was completed once; no third-party application code or detection database was copied. Linux/iOS applications and invasive/private-account enumeration remain outside scope.
