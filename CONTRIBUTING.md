# Contributing

Use Node.js 24 LTS and a current stable Rust toolchain. Follow the setup in README.md.

Before submitting: `npm run check`, `npm run test:ui`, `cargo fmt --all --check`, `cargo test --workspace`, and `cargo clippy --workspace --all-targets -- -D warnings`.

New connectors need permitted public endpoints and deterministic positive, negative, ambiguous, blocked, and invalid-input tests. Do not use account recovery, signup, or authentication bypasses. Keep account existence separate from identity ownership. Never submit captured credentials or private profile data.

Use a feature branch and a pull request. Required CI checks must pass before merge. Original contributions use the MIT license; incorporated third-party material must retain required notices.
