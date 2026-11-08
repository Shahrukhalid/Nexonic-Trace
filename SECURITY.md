# Security policy

Nexonic Trace is in early development. Do not rely on this build as a complete exposure assessment.

Report vulnerabilities using the repository's private vulnerability reporting feature when available. Avoid posting passwords, API keys, personal searches, or other sensitive evidence in public issues. Security updates currently target the latest development revision.

Only fixed HTTPS public API destinations are requested. Redirects are refused, bodies are bounded, and profiles require structured evidence. The UI cannot issue arbitrary network requests. Source links are validated before the native app opens them. No analytics is enabled. Provider keys are kept only in zeroizing process memory; passwords are never retained. SQLite search history is opt-in and deletable. Sensitive/protected breach records are excluded. Reports escape untrusted content and support redaction.
