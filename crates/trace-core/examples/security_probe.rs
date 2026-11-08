//! Explicit live provider smoke checks using only published provider test fixtures.
use zeroize::Zeroizing;
#[tokio::main]
async fn main() {
    let result = trace_core::security::check_password(Zeroizing::new("password".into()))
        .await
        .expect("password provider test failed");
    assert!(result.occurrences > 0);
    println!("Pwned Passwords: expected exposed-test-password match, prefix-only request.");
    let key = "0".repeat(32); // Official HIBP public integration-test key; not a credential.
    let records =
        trace_core::security::email_breaches("account-exists@hibp-integration-tests.com", &key)
            .await
            .expect("HIBP test fixture failed");
    assert!(!records.is_empty());
    assert!(records.iter().all(|b| b.is_verified && !b.is_sensitive));
    println!("HIBP: official positive test fixture passed.");
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    let records =
        trace_core::security::email_breaches("sensitive-breach@hibp-integration-tests.com", &key)
            .await
            .expect("HIBP protected-fixture test failed");
    assert!(records.is_empty());
    println!("HIBP: sensitive test fixture excluded.");
}
