Nexonic Trace production packages for Windows x64, macOS Apple Silicon/Intel, and Android ARM64/ARM32.

The release workflow verifies trusted timestamped Windows publisher signatures, Apple Developer ID signatures and stapled notarization, the pinned Android release signer, native release startup, Android release UI instrumentation, bundled license notices, and package integrity. `VALIDATION-*.json` identifies the exact source commit, checks and tested Android ABI. `SHA256SUMS.txt` covers all eight downloads.

Android UI acceptance runs on an isolated x86_64 emulator; ARM64/ARM32 packages receive signature, manifest, ABI, notice and 16 KiB alignment checks. This does not claim physical ARM device acceptance. Provider-based search requires the user's own licensed service credentials. Search results are limited to each selected provider's index and never prove complete internet or dark-web coverage.

Windows portable: extract the entire ZIP into a writable folder; WebView2 Runtime is required. Its ordinary data stays beside the executable. Provider keys remain in memory for the session. History is off by default. No analytics or automatic background searches are enabled.
