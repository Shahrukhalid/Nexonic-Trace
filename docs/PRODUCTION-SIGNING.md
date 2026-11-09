# Production signing

Production publication starts disabled. The separate **Production signing** workflow can build a signed candidate from protected `main` without publishing. Every one of the nine ordinary source checks must already be successful on the exact commit. Select `android` to validate its existing identity, or `all` after adding trusted desktop credentials. Candidate artifacts expire after 14 days and are not production downloads.

The `production-signing` GitHub environment limits deployment to `main` and `v*` tags. Release tag creation is restricted to the repository owner, and existing release tags cannot be moved or deleted. Production tags must equal the application version and resolve to the exact checked source. Pull request workflows receive no signing material. Never put private keys, passwords, certificates containing private keys, or provider credentials into source, chat, issues, or build artifacts. Configure secrets directly in [GitHub environment settings](https://github.com/Shahrukhalid/Nexonic-Trace/settings/environments).

## Android identity

A permanent RSA 3072-bit PKCS12 release identity has been generated. Its public certificate and SHA-256 fingerprint are in `release/`; those files contain no private key. The encrypted private backup is outside this repository in the workspace's `outputs/signing-private` folder, restricted to its owner. Its password is in macOS Keychain under service **Nexonic Trace Android Release**, account **nexonic-trace-release**. Use Keychain Access to recover it locally. Keep an encrypted offline backup; losing this identity prevents updates to installations signed with it. Never regenerate it for a routine release.

Environment secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Variable: `ANDROID_SIGNING_CERT_SHA256`, matching `release/android-signing.json`. `scripts/setup_android_signing.py` refuses to replace an existing identity. This key is for direct APK distribution; a future Play App Signing enrollment requires its own upload-key decision.

Release candidates verify the pinned signer, APK integrity, non-debuggable manifest, disabled backups/cleartext, runtime notices, ARM64/ARM32 contents, and 16 KiB ELF/ZIP alignment. An isolated x86_64 emulator runs UI instrumentation from a separate test process against the actual optimized release app. The test process has its own development identity and does not need the release key. The validation record states the tested ABI. ARM packages receive static checks; physical ARM device acceptance remains a separate distribution check.

## macOS account required

Enroll the legal publisher in [Apple Developer](https://developer.apple.com/programs/) and obtain a **Developer ID Application** certificate with its private key. Export an encrypted PKCS12 certificate locally. Create an App Store Connect API key permitted to submit notarization. Account enrollment, identity verification and fees must be completed by the publisher.

Environment secrets: `APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_API_PRIVATE_KEY_BASE64` (the `.p8` key). Variables: `APPLE_SIGNING_IDENTITY` (full Developer ID Application identity), `APPLE_TEAM_ID`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`. Private notarization material is staged only in an isolated runner directory and removed on completion. Tauri signs and notarizes the app; the workflow additionally notarizes and staples the disk image, verifies Developer ID/team/hardened runtime, checks Gatekeeper and disk integrity, and launches the actual optimized application on both native Mac architectures.

## Windows account required

Obtain a publicly trusted code-signing service for the legal publisher. A self-signed certificate is insufficient. Choose one supported mode:

- `WINDOWS_SIGNING_MODE=azure`: configure Azure Artifact Signing, its certificate profile, and GitHub OIDC federation restricted to this repository's `production-signing` environment. Assign the minimum certificate-profile signer role. Variables: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_CERTIFICATE_PROFILE`. Check [current enrollment eligibility](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart) before selecting this provider; availability depends on country and publisher type. No Azure client secret is stored.
- `WINDOWS_SIGNING_MODE=pfx`: only if the issuer permits an exportable software signing key. Secrets: `WINDOWS_CERTIFICATE_BASE64`, `WINDOWS_CERTIFICATE_PASSWORD`. Variable: `WINDOWS_CERTIFICATE_THUMBPRINT`. Hardware-only certificates need a compatible signing-service integration instead.

Both modes require `WINDOWS_EXPECTED_PUBLISHER`, the exact trusted certificate publisher name. The executable and installer receive SHA-256 signatures and RFC 3161 timestamps. Verification rejects missing/untrusted signatures, missing timestamps, and a different publisher. It then installs and launches the actual installer and portable release using disposable data. Timestamping does not guarantee immediate Windows reputation warnings will disappear.

## Activation and release

Leave `PRODUCTION_RELEASES_ENABLED=false` until one **all-platform** candidate passes. From an up-to-date local `main`, run:

```sh
python3 scripts/activate_production.py RUN_ID
python3 scripts/activate_production.py RUN_ID --enable
```

The helper requires the repository owner, successful jobs for all four target groups on current protected `main`, and exact artifacts with matching signatures, source identity and checksums. An Android-only success cannot unlock production. After activation, create the version tag on that same checked commit. Production publication rebuilds and re-verifies every target; no candidate artifacts are silently promoted. An existing production release is never overwritten. Disable production at any time by setting the environment variable back to `false`.

Until these steps pass, the public downloads remain explicitly marked development builds. No Apple or Windows signing identity is currently available.
