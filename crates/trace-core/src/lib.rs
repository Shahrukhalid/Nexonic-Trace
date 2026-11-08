//! Public API discovery. Account existence is never an ownership assertion.
use chrono::Utc;
use futures_util::{stream::FuturesUnordered, StreamExt};
use reqwest::{redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ResultStatus {
    Confirmed,
    Probable,
    NotFound,
    Inconclusive,
    Blocked,
    Unsupported,
    InvalidUsername,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub site: String,
    pub category: String,
    pub url: String,
    pub status: ResultStatus,
    pub evidence: Vec<String>,
    pub checked_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSummary {
    pub job_id: String,
    pub findings: Vec<Finding>,
    pub canceled: bool,
    pub total: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchUpdate {
    pub job_id: String,
    pub finding: Finding,
    pub completed: usize,
    pub total: usize,
}

#[derive(Clone, Copy, Debug)]
pub enum Site {
    GitHub,
    DevCommunity,
}

impl Site {
    pub fn name(self) -> &'static str {
        match self {
            Self::GitHub => "GitHub",
            Self::DevCommunity => "DEV Community",
        }
    }

    fn profile_url(self, username: &str) -> String {
        match self {
            Self::GitHub => format!("https://github.com/{username}"),
            Self::DevCommunity => format!("https://dev.to/{username}"),
        }
    }

    fn endpoint(self, username: &str) -> String {
        match self {
            Self::GitHub => format!("https://api.github.com/users/{username}"),
            Self::DevCommunity => format!("https://dev.to/api/users/by_username?url={username}"),
        }
    }

    fn valid_username(self, username: &str) -> bool {
        if !valid_query(username) {
            return false;
        }
        match self {
            Self::GitHub => {
                !username.contains('_') && !username.ends_with('-') && !username.contains("--")
            }
            Self::DevCommunity => true,
        }
    }
}

pub fn valid_query(query: &str) -> bool {
    !query.is_empty()
        && query.len() <= 39
        && query.as_bytes()[0].is_ascii_alphanumeric()
        && query
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Destinations are generated from fixed hosts, never user-provided URLs.
/// Redirects are deliberately refused, including redirects to private networks.
pub fn http_client(timeout: u64) -> Result<Client, reqwest::Error> {
    Client::builder()
        .user_agent("NexonicTrace/0.1.0 (+https://github.com/Shahrukhalid/Nexonic-Trace)")
        .https_only(true)
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(timeout.clamp(5, 30)))
        .build()
}

/// Pure verification makes negative and ambiguous response regression tests deterministic.
pub fn classify(
    site: Site,
    username: &str,
    status: u16,
    content_type: &str,
    body: &str,
) -> (ResultStatus, Vec<String>) {
    let explain = |status, message: &str| (status, vec![message.to_string()]);
    if matches!(status, 401 | 403 | 429) {
        return explain(ResultStatus::Blocked, "The provider denied access or rate limited the request. No bypass or retry was attempted.");
    }
    if (300..400).contains(&status) {
        return explain(ResultStatus::Inconclusive, "The source redirected. Redirects are not followed; a redirect is not proof of account existence.");
    }
    // An HTML challenge can return HTTP 200 or 404. Only parse supported JSON responses.
    if !content_type
        .to_ascii_lowercase()
        .contains("application/json")
    {
        return explain(
            ResultStatus::Inconclusive,
            "The response was not the expected JSON API payload; it may be an access page.",
        );
    }
    let Ok(data) = serde_json::from_str::<Value>(body) else {
        return explain(
            ResultStatus::Inconclusive,
            "The API response could not be parsed. No existence assertion was made.",
        );
    };
    if status == 404 {
        let missing = match site {
            Site::GitHub => data["message"].as_str() == Some("Not Found"),
            Site::DevCommunity => {
                data["status"].as_u64() == Some(404)
                    && data["error"]
                        .as_str()
                        .is_some_and(|e| e.to_lowercase().contains("not found"))
            }
        };
        return if missing {
            explain(
                ResultStatus::NotFound,
                "The official API returned HTTP 404 with its expected missing-profile indicator.",
            )
        } else {
            explain(ResultStatus::Inconclusive, "HTTP 404 without the expected missing-profile indicator. The account status is uncertain.")
        };
    }
    if status != 200 {
        return explain(
            ResultStatus::Inconclusive,
            "The API returned an unexpected status. No account-existence assertion was made.",
        );
    }
    let login_key = match site {
        Site::GitHub => "login",
        Site::DevCommunity => "username",
    };
    let matching_name = data[login_key]
        .as_str()
        .is_some_and(|s| s.eq_ignore_ascii_case(username));
    let numeric_id = data["id"].as_u64().is_some_and(|id| id > 0);
    let profile_signal = match site {
        Site::GitHub => {
            data["html_url"]
                .as_str()
                .is_some_and(|u| u.eq_ignore_ascii_case(&site.profile_url(username)))
                && matches!(data["type"].as_str(), Some("User" | "Organization"))
        }
        Site::DevCommunity => data["type_of"].as_str() == Some("user"),
    };
    if matching_name && numeric_id && profile_signal {
        (ResultStatus::Confirmed, vec![
            "The official public API returned HTTP 200 with a structured profile.".into(),
            "The returned username matches the query and includes a positive numeric account identifier.".into(),
            "The provider-specific profile fields passed verification. This confirms existence, not identity ownership.".into(),
        ])
    } else {
        explain(ResultStatus::Inconclusive, "HTTP 200 alone is insufficient. The username, account ID, or provider-specific profile fields did not pass verification.")
    }
}

async fn check_site(client: &Client, site: Site, username: &str) -> Finding {
    let mut finding = Finding {
        site: site.name().into(),
        category: "Developer community".into(),
        url: site.profile_url(username),
        status: ResultStatus::Inconclusive,
        evidence: Vec::new(),
        checked_at: Utc::now().to_rfc3339(),
    };
    if !site.valid_username(username) {
        finding.status = ResultStatus::InvalidUsername;
        finding.evidence.push(
            "The username does not satisfy this connector's supported syntax. No request was made."
                .into(),
        );
        return finding;
    }
    let response = client
        .get(site.endpoint(username))
        .header("Accept", "application/json")
        .send()
        .await;
    match response {
        Ok(mut response) => {
            let status = response.status().as_u16();
            let content_type = response
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_owned();
            let mut body = Vec::new();
            loop {
                match response.chunk().await {
                    Ok(Some(chunk)) => {
                        if body.len() + chunk.len() > 131_072 {
                            finding.evidence.push(
                                "The response exceeded the 128 KiB limit and was discarded.".into(),
                            );
                            return finding;
                        }
                        body.extend_from_slice(&chunk);
                    }
                    Ok(None) => break,
                    Err(_) => {
                        finding.evidence.push(
                            "The response body could not be read. No account status was inferred."
                                .into(),
                        );
                        return finding;
                    }
                }
            }
            (finding.status, finding.evidence) = classify(
                site,
                username,
                status,
                &content_type,
                &String::from_utf8_lossy(&body),
            );
        }
        Err(error) => {
            finding.evidence.push(
                if error.is_timeout() {
                    "The request timed out. This does not mean the profile is absent."
                } else {
                    "The network request failed. This does not mean the profile is absent."
                }
                .into(),
            );
        }
    }
    finding.checked_at = Utc::now().to_rfc3339();
    finding
}

/// Two distinct domains, at most two concurrent requests; no automatic retries.
/// The caller serializes jobs and enforces a cooldown between starts.
pub async fn discover(
    job_id: String,
    username: &str,
    timeout: u64,
    cancellation: CancellationToken,
    mut on_update: impl FnMut(SearchUpdate),
) -> Result<SearchSummary, String> {
    if !valid_query(username) {
        return Err(
            "Enter a supported username (1–39 ASCII letters, digits, underscores, or hyphens)."
                .into(),
        );
    }
    let client =
        http_client(timeout).map_err(|_| "Could not initialize the secure HTTP client.")?;
    let mut pending = FuturesUnordered::new();
    for site in [Site::GitHub, Site::DevCommunity] {
        pending.push(check_site(&client, site, username));
    }
    let mut summary = SearchSummary {
        job_id,
        findings: Vec::new(),
        canceled: false,
        total: 2,
    };
    loop {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => { summary.canceled = true; break; }
            result = pending.next() => {
                let Some(finding) = result else { break; };
                summary.findings.push(finding.clone());
                on_update(SearchUpdate { job_id: summary.job_id.clone(), finding, completed: summary.findings.len(), total: summary.total });
            }
        }
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn status(site: Site, code: u16, body: &str) -> ResultStatus {
        classify(site, "octocat", code, "application/json", body).0
    }
    #[test]
    fn http_success_is_not_confirmation() {
        assert_eq!(status(Site::GitHub, 200, "{}"), ResultStatus::Inconclusive);
    }
    #[test]
    fn confirms_structured_profile() {
        assert_eq!(
            status(
                Site::GitHub,
                200,
                r#"{"id":1,"login":"octocat","html_url":"https://github.com/octocat","type":"User"}"#
            ),
            ResultStatus::Confirmed
        );
    }
    #[test]
    fn mismatched_username_is_inconclusive() {
        assert_eq!(
            status(
                Site::GitHub,
                200,
                r#"{"id":1,"login":"other","html_url":"https://github.com/octocat","type":"User"}"#
            ),
            ResultStatus::Inconclusive
        );
    }
    #[test]
    fn malicious_profile_url_is_inconclusive() {
        assert_eq!(
            status(
                Site::GitHub,
                200,
                r#"{"id":1,"login":"octocat","html_url":"http://127.0.0.1/","type":"User"}"#
            ),
            ResultStatus::Inconclusive
        );
    }
    #[test]
    fn missing_profile_requires_negative_signal() {
        assert_eq!(
            status(Site::GitHub, 404, r#"{"message":"Not Found"}"#),
            ResultStatus::NotFound
        );
        assert_eq!(status(Site::GitHub, 404, "{}"), ResultStatus::Inconclusive);
    }
    #[test]
    fn blocked_and_rate_limited() {
        for code in [401, 403, 429] {
            assert_eq!(status(Site::GitHub, code, "{}"), ResultStatus::Blocked);
        }
    }
    #[test]
    fn html_challenge_is_not_confirmation() {
        assert_eq!(
            classify(
                Site::GitHub,
                "octocat",
                200,
                "text/html",
                "<h1>Verify access</h1>"
            )
            .0,
            ResultStatus::Inconclusive
        );
    }
    #[test]
    fn redirects_are_inconclusive() {
        assert_eq!(status(Site::GitHub, 302, "{}"), ResultStatus::Inconclusive);
    }
    #[test]
    fn malformed_json_is_inconclusive() {
        assert_eq!(status(Site::GitHub, 200, "{"), ResultStatus::Inconclusive);
    }
    #[test]
    fn dev_profile_requires_type_and_id() {
        assert_eq!(
            status(
                Site::DevCommunity,
                200,
                r#"{"username":"octocat","id":12,"type_of":"user"}"#
            ),
            ResultStatus::Confirmed
        );
        assert_eq!(
            status(Site::DevCommunity, 200, r#"{"username":"octocat"}"#),
            ResultStatus::Inconclusive
        );
    }
    #[test]
    fn rejects_unsafe_queries() {
        for query in [
            "",
            "../admin",
            "a@b.com",
            "a?x=1",
            "http://localhost",
            "a/b",
            "a b",
            "ñame",
        ] {
            assert!(!valid_query(query));
        }
    }
    #[tokio::test]
    async fn cancellation_stops_before_requests() {
        let cancel = CancellationToken::new();
        cancel.cancel();
        let result = discover("test".into(), "octocat", 5, cancel, |_| {
            panic!("unexpected result")
        })
        .await
        .unwrap();
        assert!(result.canceled);
        assert!(result.findings.is_empty());
    }
}
