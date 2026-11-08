# Dependency security gate

The npm gate rejects high or critical advisories. RustSec scans the complete committed Cargo lockfile against a freshly fetched advisory database. `scripts/security_audit.py` then checks every finding against the union of six actual supported Cargo dependency graphs: Windows x64, macOS ARM64/Intel, Android ARM64/ARM32 and the Android x64 test emulator. Runtime, build and development dependencies are included. Unknown scanner schemas and download failures fail the gate. There is no advisory-ID ignore list.

The 2026-11-08 scan found no advisories reachable in those graphs. It reported five findings in unrelated Linux-only lockfile dependencies, which the gate discloses without suppressing them:

- [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370): proc-macro-error 1.0.4, unmaintained.
- [RUSTSEC-2026-0371](https://rustsec.org/advisories/RUSTSEC-2026-0371): zbus_names 4.3.5, unmaintained.
- [RUSTSEC-2026-0370](https://rustsec.org/advisories/RUSTSEC-2026-0370): zvariant 5.15.1, unmaintained.
- [RUSTSEC-2026-0372](https://rustsec.org/advisories/RUSTSEC-2026-0372): zvariant_derive 5.15.1, unmaintained.
- [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429): glib 0.18.5, unsound VariantStrIter implementation.

Linux and iOS application builds are outside scope. Adding either platform requires fixing its reachable findings before enabling release packaging. New dependencies or target changes are reassessed on every CI run. This gate is a dependency check, not a claim of a comprehensive independent security audit.
