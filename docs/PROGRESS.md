# Development checkpoint

- M0: application workspace, shared typed models, license/policies, lockfiles, and macOS/Windows CI implemented. Hosted CI outcome must be recorded after it runs.
- M1: responsive application shell implemented. Native launch and Android device validation must be tracked separately; a mobile browser smoke test is not an APK test.
- M2: initial shared engine for two fixed public APIs, cancellation, bounded responses, and structured verification implemented.
- M3–M4: hard-coded initial connectors and deterministic verification tests exist; versioned rule schema, broader fixtures, connector maintenance, and reliability certification remain.
- M5–M12: not complete. Interface sections describe unavailable capabilities. No production release or signing claim.

Next: extend versioned connector definitions with source-specific syntax, positive/negative fixtures and validation dates; add global/per-domain scheduling before expanding coverage; implement SQLite opt-in persistence; initialize and validate Android tooling; implement authorized exposure providers and password prefix checks; complete packaging, security and license gates before release.

Architecture review completed once. Independently implemented code; no external source/rule database incorporated. Use bounded async work, explicit cancellation, source-specific positive and negative signals, minimal evidence metadata, and narrow native capabilities. Avoid whole-page retention and arbitrary URL fetching. Re-run research only when a concrete compatibility or provider question requires it.
