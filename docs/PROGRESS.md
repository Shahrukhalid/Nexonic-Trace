# Development checkpoint

- M0: application workspace, shared typed models, license/policies, lockfiles, and macOS/Windows CI implemented. Local build, type checks, formatting, Clippy, 5 frontend unit tests, 8 browser UI tests, and 12 Rust tests pass. Hosted CI is running in PR #1. Secret scanning/push protection and required CI checks are enabled.
- M1: responsive application shell implemented. Native binary built and launched, but visual desktop verification is blocked because the Mac is locked. Android device validation is pending; a mobile browser smoke test is not an APK test.
- M2: initial shared engine for two fixed public APIs, cancellation, bounded responses, and structured verification implemented.
- M3–M4: hard-coded initial connectors and deterministic verification tests exist; versioned rule schema, broader fixtures, connector maintenance, and reliability certification remain.
- M5–M12: not complete. Interface sections describe unavailable capabilities. No production release or signing claim.

Next: extend versioned connector definitions with source-specific syntax, positive/negative fixtures and validation dates; add global/per-domain scheduling before expanding coverage; implement SQLite opt-in persistence; initialize and validate Android tooling; implement authorized exposure providers and password prefix checks; complete packaging, security and license gates before release.

Architecture review completed once. Independently implemented code; no external source/rule database incorporated. Use bounded async work, explicit cancellation, source-specific positive and negative signals, minimal evidence metadata, and narrow native capabilities. Avoid whole-page retention and arbitrary URL fetching. Re-run research only when a concrete compatibility or provider question requires it.

Limited live validation: GitHub and DEV Community both confirmed `octocat` and `ben`; both returned not found for `nexonic-missing-8f9e1c472a`. This is a smoke check, not broad connector accuracy certification. Initial hosted macOS jobs used a retired runner; migrated to supported macOS 15.
