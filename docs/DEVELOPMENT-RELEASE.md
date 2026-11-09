Nexonic Trace development test builds for Windows x64, macOS Apple Silicon and Intel, and Android ARM64/ARM32.

This update adds visible Profiles / Web / Dark web search areas. Public-web discovery can retrieve up to 20/60/100 indexed results through your licensed Brave Search account. DarkOwl integration searches licensed dark-web metadata for authorized usernames/emails without fetching leaked documents. HIBP stealer-log domain checks require a Pro plan and provider-verified domain control. Keys remain session-only. No search covers the entire internet or every dark-web source.

Nexonic Trace checks GitHub for updates at startup. You can also select **Settings → Check for updates**. When a newer development build is available for your device, the app links to its GitHub download page for manual installation.

Direct profile checks use permitted public APIs with conservative verification. Authorized HIBP email breaches exclude sensitive/unverified records. Password checks send only a five-character hash prefix to Pwned Passwords, independently of email searches. A mention does not establish ownership or an exposed credential pair. The permanent Android production identity and protected signing workflow are separate from these development downloads.

These are development artifacts, not production-signed releases. Windows executables are unsigned. Mac apps are ad-hoc signed and are not notarized; Gatekeeper can block them. Android APKs use development certificates and are not Play Store releases. Android may require a fresh install if the new APK was signed with a different development certificate. Production distribution is blocked pending protected signing credentials and production acceptance. Do not bypass operating-system protections.

Download the package matching your system and verify its SHA-256 against `SHA256SUMS.txt`. Windows portable users must extract the entire ZIP into a writable folder and have Microsoft Edge WebView2 Runtime installed. Keep `portable.txt` beside the executable; ordinary settings and opted-in history live in `NexonicTraceData`. Provider keys remain in session memory. All packages include upstream notices and required source archives.

Validation records accompany the files. GitHub builds exercise actual native launch, Rust communication, navigation, preference persistence, deletion, installer and portable execution, and Android device tests. Live external-provider availability and changing third-party websites can still limit coverage. Confirmed profile existence never establishes account ownership.
