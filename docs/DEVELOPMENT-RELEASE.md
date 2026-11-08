Nexonic Trace development test builds for Windows x64, macOS Apple Silicon and Intel, and Android ARM64/ARM32.

The workspace is simplified for fast searches, evidence review, local opt-in history, comparisons and redacted exports. Username checks use five permitted public APIs with conservative verification. Public-web discovery requires your own licensed Brave Search key. Authorized email breach checks require your own licensed HIBP key; sensitive breach responses are excluded. Password checks send only a five-character hash prefix to Pwned Passwords.

These are development artifacts, not production-signed releases. Windows executables are unsigned. Mac apps are ad-hoc signed and are not notarized; Gatekeeper can block them. Android APKs use development certificates and are not Play Store releases. Production distribution is blocked pending protected signing credentials and production acceptance. Do not bypass operating-system protections.

Download the package matching your system and verify its SHA-256 against `SHA256SUMS.txt`. Windows portable users must extract the entire ZIP into a writable folder and have Microsoft Edge WebView2 Runtime installed. Keep `portable.txt` beside the executable; ordinary settings and opted-in history live in `NexonicTraceData`. Provider keys remain in session memory. All packages include upstream notices and required source archives.

Validation records accompany the files. GitHub builds exercise actual native launch, Rust communication, navigation, preference persistence, deletion, installer and portable execution, and Android device tests. Live external-provider availability and changing third-party websites can still limit coverage. Confirmed profile existence never establishes account ownership.
