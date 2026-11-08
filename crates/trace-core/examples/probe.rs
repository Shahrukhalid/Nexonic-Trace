//! Explicit live smoke check; never runs in the deterministic unit suite.
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() {
    let query = std::env::args()
        .nth(1)
        .expect("Usage: cargo run -p trace-core --example probe -- USERNAME");
    let summary = trace_core::Engine::default()
        .discover(
            "probe".into(),
            &query,
            &std::env::args().nth(2).unwrap_or("quick".into()),
            12,
            CancellationToken::new(),
            |_| {},
        )
        .await
        .expect("search failed");
    println!("{}", serde_json::to_string_pretty(&summary).unwrap());
}
