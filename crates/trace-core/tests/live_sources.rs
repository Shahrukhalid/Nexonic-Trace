//! Live drift check: every bundled rule is queried against its provider with
//! the known public account from the fixtures and with an impossible username.
//! Runs only when NEXONIC_LIVE=1 (scheduled CI); ordinary test runs skip it.
use serde_json::Value;
use std::time::Duration;
use trace_core::{classify, http_client, registry, ResultStatus};

async fn fetch(client: &reqwest::Client, url: &str) -> Result<(u16, String, String), String> {
    let response = client
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    let body = response
        .text()
        .await
        .map_err(|e| format!("body unreadable: {e}"))?;
    Ok((status, content_type, body.chars().take(200_000).collect()))
}

#[tokio::test]
async fn every_source_still_behaves_as_its_rule_expects() {
    if std::env::var("NEXONIC_LIVE").as_deref() != Ok("1") {
        eprintln!("Live source check skipped (set NEXONIC_LIVE=1 to run).");
        return;
    }
    let fixtures: Value =
        serde_json::from_str(include_str!("fixtures/connectors.json")).expect("fixtures");
    let missing = fixtures["missingQuery"].as_str().unwrap();
    let client = http_client(20).expect("client");
    let mut report = Vec::new();
    let mut drift = Vec::new();
    for rule in registry::ordered() {
        let known = fixtures["connectors"][&rule.id]["query"]
            .as_str()
            .unwrap_or("");
        for (query, expected) in [
            (known, ResultStatus::Confirmed),
            (missing, ResultStatus::NotFound),
        ] {
            let url = rule.api_url.replace("{username}", query);
            let outcome = match fetch(&client, &url).await {
                Ok((status, ct, body)) => {
                    let (result, _) = classify(rule, query, status, &ct, &body);
                    if result == expected {
                        "ok".to_string()
                    } else {
                        let snippet: String = body.chars().take(160).collect();
                        format!("expected {expected:?}, got {result:?} (HTTP {status}, {ct}): {snippet}")
                    }
                }
                Err(e) => e,
            };
            if outcome != "ok" {
                drift.push(format!("- {} `{query}`: {outcome}", rule.name));
            }
            report.push(format!("{}\t{query}\t{outcome}", rule.id));
            // Polite pacing: one request per second overall.
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }
    println!("{}", report.join("\n"));
    if let Ok(path) = std::env::var("NEXONIC_DRIFT_REPORT") {
        std::fs::write(path, drift.join("\n")).ok();
    }
    assert!(
        drift.is_empty(),
        "Source drift detected:\n{}",
        drift.join("\n")
    );
}
