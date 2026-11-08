use crate::{http_client, Finding, PublicField, ResultStatus};
use chrono::Utc;
use reqwest::Response;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::collections::HashSet;
use zeroize::{Zeroize, Zeroizing};

pub async fn bounded_body(mut response: Response) -> Result<(u16, String), String> {
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The provider response could not be read.")?
    {
        if bytes.len() + chunk.len() > 1_048_576 {
            return Err("The provider response exceeded the safety limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes)
        .map(|body| (status, body))
        .map_err(|_| "The provider returned invalid text.".into())
}
pub fn provider_error(status: u16) -> String {
    match status {
        401 | 403 => "The provider denied access. Check your key and subscription.",
        429 => "The provider rate limit was reached. Wait before trying again.",
        _ => "The provider could not complete the request. No result was inferred.",
    }
    .into()
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordCheck {
    pub occurrences: u64,
    pub checked_at: String,
    pub provider: String,
}

pub fn range_match(suffix: &str, body: &str) -> Result<u64, String> {
    let mut matches = 0;
    let mut rows = 0;
    for line in body.lines().filter(|line| !line.trim().is_empty()) {
        let (hash, count) = line
            .trim()
            .split_once(':')
            .ok_or("Unexpected password-provider response.")?;
        if hash.len() != 35 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Unexpected password-provider response.".into());
        }
        let count = count
            .parse::<u64>()
            .map_err(|_| "Unexpected password-provider count.")?;
        if hash.eq_ignore_ascii_case(suffix) {
            matches = count;
        }
        rows += 1;
    }
    if rows == 0 {
        return Err("Empty password-provider response. No safety result was inferred.".into());
    }
    Ok(matches)
}
pub async fn check_password(mut password: Zeroizing<String>) -> Result<PasswordCheck, String> {
    if password.is_empty() || password.len() > 4096 {
        return Err("Enter a password of at most 4096 bytes.".into());
    }
    let mut digest = Sha1::digest(password.as_bytes());
    password.zeroize();
    let hash = Zeroizing::new(format!("{digest:X}"));
    digest[..].zeroize();
    // Only these five hexadecimal characters leave the device. Neither the complete
    // hash nor its suffix is included in the URL, headers, logs, history, or return value.
    let url = format!("https://api.pwnedpasswords.com/range/{}", &hash[..5]);
    let response = http_client(20)
        .map_err(|_| "Could not create the secure client.")?
        .get(url)
        .header("Add-Padding", "true")
        .send()
        .await
        .map_err(|_| "Password provider unavailable. No safety result was inferred.")?;
    let (status, body) = bounded_body(response).await?;
    if status != 200 {
        return Err(provider_error(status));
    }
    let occurrences = range_match(&hash[5..], &body)?;
    Ok(PasswordCheck {
        occurrences,
        checked_at: Utc::now().to_rfc3339(),
        provider: "Pwned Passwords".into(),
    })
}
pub fn valid_email(query: &str) -> bool {
    query.len()<=254 && regex::Regex::new(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$").unwrap().is_match(query)
}
/// External result links are opened only on explicit user action, never fetched by this app.
pub fn public_source_url(value: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(value) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_end_matches('.');
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && host.contains('.')
        && host.parse::<std::net::IpAddr>().is_err()
        && !host.starts_with('[')
        && ![
            "localhost",
            ".localhost",
            ".local",
            ".internal",
            ".test",
            ".invalid",
        ]
        .iter()
        .any(|suffix| host.ends_with(suffix))
}
pub async fn public_search(query: &str, key: &str, limit: usize) -> Result<Vec<Finding>, String> {
    if query.len() > 254 || query.trim().is_empty() || query.chars().any(char::is_control) {
        return Err("Invalid public-search query.".into());
    }
    let client = http_client(20).map_err(|_| "Could not create the secure client.")?;
    let response = client
        .get("https://api.search.brave.com/res/v1/web/search")
        .query(&[
            ("q", format!("\"{query}\"")),
            ("count", limit.clamp(1, 10).to_string()),
        ])
        .header("X-Subscription-Token", key)
        .send()
        .await
        .map_err(|_| "Public-search provider unavailable.")?;
    let (status, body) = bounded_body(response).await?;
    if status != 200 {
        return Err(provider_error(status));
    }
    parse_public_search(&body)
}
pub fn parse_public_search(body: &str) -> Result<Vec<Finding>, String> {
    let data: serde_json::Value =
        serde_json::from_str(body).map_err(|_| "Invalid search-provider data.")?;
    let results = data
        .pointer("/web/results")
        .and_then(|v| v.as_array())
        .ok_or("Search provider returned no valid results collection.")?;
    let mut seen = HashSet::new();
    let mut findings = Vec::new();
    for result in results.iter().take(10) {
        let Some(url) = result["url"].as_str().filter(|url| public_source_url(url)) else {
            continue;
        };
        if !seen.insert(url) {
            continue;
        }
        let title = result["title"]
            .as_str()
            .unwrap_or("Indexed public mention")
            .chars()
            .take(160)
            .collect::<String>();
        findings.push(Finding{site:title,category:"Public web mention".into(),url:url.into(),status:ResultStatus::Inconclusive,
            evidence:vec!["Brave Search indexed this source for the supplied query. The original page has not been independently fetched or verified; this is not evidence of account registration or identity ownership.".into()],
            checked_at:Utc::now().to_rfc3339(),public_fields:Vec::<PublicField>::new(),request_outcome:"completed".into(),retryable:false});
    }
    Ok(findings)
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct Breach {
    pub name: String,
    pub title: String,
    pub domain: String,
    pub breach_date: String,
    pub data_classes: Vec<String>,
    pub is_verified: bool,
    pub is_sensitive: bool,
}
pub fn parse_breaches(body: &str) -> Result<Vec<Breach>, String> {
    let records: Vec<Breach> =
        serde_json::from_str(body).map_err(|_| "Invalid breach-provider response.")?;
    // Protected/sensitive records are never exposed through this integration, even
    // if a provider unexpectedly includes them. This is not ownership verification.
    Ok(records
        .into_iter()
        .filter(|b| b.is_verified && !b.is_sensitive)
        .collect())
}
pub async fn email_breaches(email: &str, key: &str) -> Result<Vec<Breach>, String> {
    if !valid_email(email) {
        return Err("Enter a valid email address.".into());
    }
    let mut url =
        reqwest::Url::parse("https://haveibeenpwned.com/api/v3/breachedaccount/").unwrap();
    url.path_segments_mut()
        .map_err(|_| "Invalid provider endpoint.")?
        .pop_if_empty()
        .push(email);
    url.query_pairs_mut()
        .append_pair("truncateResponse", "false")
        .append_pair("includeUnverified", "false");
    let response = http_client(20)
        .map_err(|_| "Could not create the secure client.")?
        .get(url)
        .header("hibp-api-key", key)
        .send()
        .await
        .map_err(|_| "Breach provider unavailable. No safety result was inferred.")?;
    let (status, body) = bounded_body(response).await?;
    if status == 404 {
        return Ok(Vec::new());
    }
    if status != 200 {
        return Err(provider_error(status));
    }
    parse_breaches(&body)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn password_range_matches_locally_and_ignores_padding() {
        let suffix = "A".repeat(35);
        let body = format!("{}:0\r\n{suffix}:42\r\n", "B".repeat(35));
        assert_eq!(range_match(&suffix, &body).unwrap(), 42);
        assert_eq!(range_match(&"C".repeat(35), &body).unwrap(), 0);
    }
    #[test]
    fn malformed_password_data_never_means_clean() {
        for text in [
            "",
            "<html>blocked</html>",
            "A:123",
            &format!("{}:abc", "A".repeat(35)),
        ] {
            assert!(range_match(&"A".repeat(35), text).is_err());
        }
    }
    #[test]
    fn source_links_reject_private_and_unsafe_destinations() {
        for url in [
            "http://example.com",
            "https://127.0.0.1/",
            "https://[::1]/",
            "https://localhost/",
            "https://foo.local/",
            "https://user:pass@example.com/",
        ] {
            assert!(!public_source_url(url));
        }
        assert!(public_source_url("https://example.org/profile"));
    }
    #[test]
    fn search_results_are_deduplicated_and_unverified() {
        let results=parse_public_search(r#"{"web":{"results":[{"title":"Mention","url":"https://example.org/a"},{"url":"https://example.org/a"},{"url":"http://127.0.0.1/a"}]}}"#).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].status, ResultStatus::Inconclusive);
    }
    #[test]
    fn sensitive_and_unverified_breaches_are_not_disclosed() {
        let body = r#"[{"Name":"a","Title":"a","Domain":"example.com","BreachDate":"2020-01-01","DataClasses":["Emails"],"IsVerified":true,"IsSensitive":true}]"#;
        assert!(parse_breaches(body).unwrap().is_empty());
    }
    #[test]
    fn email_validation_rejects_controls_and_paths() {
        assert!(valid_email("person+tag@example.org"));
        for email in ["x\r\n@example.org", "not-email", "https://example.org"] {
            assert!(!valid_email(email));
        }
    }
}
