# Development checkpoint

- M0: merged foundation in PR #1; all required CI passed. Secret scanning, push protection, and required checks enabled.
- M1: redesigned to a minimal search workspace, compact results, and touch navigation. Native visual/device validation still pending.
- M2–M4: five fixed public APIs; Quick/Deep/Comprehensive scopes of 2/4/5; bounded concurrency, global/per-domain pacing, one transient retry, cancellation, categorized outcomes, structured verification, and versioned rule validation implemented.
- Live smoke checks: all five sources confirmed `thibault` and returned not found for `nt-zz-8f9e1c472a`. No ownership association is asserted. Dates recorded in rule metadata; regression fixtures test ambiguous, missing, blocked, and mismatched profiles.
- Local checks: 18 core Rust tests, 1 native source-link test, 5 frontend utility tests, and 10 desktop/mobile UI tests pass; formatting, type/build checks, and Clippy pass. Hosted CI must pass before this milestone merges.
- M5–M9 next: approved public-search connector, authorized non-sensitive breach data, password-prefix checks, public fields, opt-in SQLite history and reports.
- M10–M12 next: full security/license gates, native platform/device validation, Windows/macOS/Android development packaging, signing credentials, and validated release publishing. Never call an unsigned test build a production release.

Architecture research completed once; no comparison source or database incorporated. Keep secrets session-only unless an OS-backed secure-storage adapter is explicitly implemented. Never persist passwords or hash material. Current app history is still session-only until the persistence milestone.
