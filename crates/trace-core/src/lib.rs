pub mod indexed;
pub mod registry;
pub mod security;
// Public API discovery. Account existence is never an ownership assertion.
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
    #[serde(default)]
    pub public_fields: Vec<PublicField>,
    #[serde(default = "default_outcome")]
    pub request_outcome: String,
    #[serde(skip)]
    pub retryable: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PublicField {
    pub label: String,
    pub value: String,
}
fn default_outcome() -> String {
    "completed".into()
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Counts {
    pub completed: usize,
    pub failed: usize,
    pub blocked: usize,
    pub skipped: usize,
}
impl SearchSummary {
    pub fn counts(&self) -> Counts {
        let mut counts = Counts {
            skipped: self.total.saturating_sub(self.findings.len()),
            ..Counts::default()
        };
        for f in &self.findings {
            match f.request_outcome.as_str() {
                "failed" => counts.failed += 1,
                "blocked" => counts.blocked += 1,
                "skipped" => counts.skipped += 1,
                _ => counts.completed += 1,
            }
        }
        counts
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSummary {
    pub job_id: String,
    pub findings: Vec<Finding>,
    pub canceled: bool,
    pub total: usize,
    #[serde(default)]
    pub warnings: Vec<String>,
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
    Codeberg,
    Lichess,
    Chess,
}

impl Site {
    pub fn name(self) -> &'static str {
        match self {
            Self::GitHub => "GitHub",
            Self::DevCommunity => "DEV Community",
            Self::Codeberg => "Codeberg",
            Self::Lichess => "Lichess",
            Self::Chess => "Chess.com",
        }
    }

    fn rule(self) -> registry::Rule {
        registry::registry()
            .sites
            .into_iter()
            .find(|r| r.name == self.name())
            .expect("built-in connector rule")
    }
    fn profile_url(self, username: &str) -> String {
        self.rule().profile_url.replace("{username}", username)
    }
    fn endpoint(self, username: &str) -> String {
        self.rule().api_url.replace("{username}", username)
    }
    fn valid_username(self, username: &str) -> bool {
        valid_query(username)
            && regex::Regex::new(&self.rule().username_pattern).is_ok_and(|r| r.is_match(username))
            && (!matches!(self, Self::GitHub) || !username.contains("--"))
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
        && !content_type
            .to_ascii_lowercase()
            .contains("application/ld+json")
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
            Site::Codeberg => data["message"].as_str().is_some_and(|v| {
                v.to_lowercase().contains("user") && v.to_lowercase().contains("not exist")
            }),
            Site::Lichess => data["error"]
                .as_str()
                .is_some_and(|v| v.eq_ignore_ascii_case("not found")),
            Site::Chess => data["message"]
                .as_str()
                .is_some_and(|v| v.to_lowercase().contains("not found")),
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
        Site::GitHub | Site::Codeberg => "login",
        Site::DevCommunity | Site::Lichess | Site::Chess => "username",
    };
    let matching_name = data[login_key]
        .as_str()
        .is_some_and(|s| s.eq_ignore_ascii_case(username));
    let numeric_id = match site {
        Site::Chess => data["player_id"].as_u64().is_some_and(|id| id > 0),
        Site::Lichess => {
            data["id"]
                .as_str()
                .is_some_and(|id| id.eq_ignore_ascii_case(username))
                && data["createdAt"].as_u64().is_some_and(|id| id > 0)
        }
        _ => data["id"].as_u64().is_some_and(|id| id > 0),
    };
    let profile_signal = match site {
        Site::GitHub => {
            data["html_url"]
                .as_str()
                .is_some_and(|u| u.eq_ignore_ascii_case(&site.profile_url(username)))
                && matches!(data["type"].as_str(), Some("User" | "Organization"))
        }
        Site::DevCommunity => data["type_of"].as_str() == Some("user"),
        Site::Codeberg => data["html_url"]
            .as_str()
            .is_some_and(|u| u.eq_ignore_ascii_case(&site.profile_url(username))),
        Site::Lichess | Site::Chess => data["url"]
            .as_str()
            .is_some_and(|u| u.eq_ignore_ascii_case(&site.profile_url(username))),
    };
    if matching_name && numeric_id && profile_signal {
        (ResultStatus::Confirmed, vec![
            "The official public API returned HTTP 200 with a structured profile.".into(),
            "The returned username matches the query and includes a provider-specific account identifier.".into(),
            "The provider-specific profile fields passed verification. This confirms existence, not identity ownership.".into(),
        ])
    } else {
        explain(ResultStatus::Inconclusive, "HTTP 200 alone is insufficient. The username, account ID, or provider-specific profile fields did not pass verification.")
    }
}

async fn check_site(client: &Client, site: Site, username: &str) -> Finding {
    let mut finding = Finding {
        site: site.name().into(),
        category: site.rule().category,
        url: site.profile_url(username),
        status: ResultStatus::Inconclusive,
        evidence: Vec::new(),
        checked_at: Utc::now().to_rfc3339(),
        public_fields: Vec::new(),
        request_outcome: "completed".into(),
        retryable: false,
    };
    if !site.valid_username(username) {
        finding.status = ResultStatus::InvalidUsername;
        finding.request_outcome = "skipped".into();
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
            finding.retryable = status >= 500;
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
                            finding.request_outcome = "failed".into();
                            finding.evidence.push(
                                "The response exceeded the 128 KiB limit and was discarded.".into(),
                            );
                            return finding;
                        }
                        body.extend_from_slice(&chunk);
                    }
                    Ok(None) => break,
                    Err(_) => {
                        finding.request_outcome = "failed".into();
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
            if finding.status == ResultStatus::Blocked {
                finding.request_outcome = "blocked".into();
            }
            if finding.status == ResultStatus::Confirmed {
                if let Ok(data) = serde_json::from_slice::<Value>(&body) {
                    for (key, label) in [
                        ("name", "Public name"),
                        ("bio", "Public description"),
                        ("summary", "Public description"),
                        ("website_url", "Public website"),
                        ("blog", "Public website"),
                        ("email", "Public email"),
                    ] {
                        if let Some(value) = data[key].as_str().filter(|v| !v.trim().is_empty()) {
                            finding.public_fields.push(PublicField {
                                label: label.into(),
                                value: value.chars().take(500).collect(),
                            });
                        }
                    }
                }
            }
        }
        Err(error) => {
            finding.request_outcome = "failed".into();
            finding.retryable = error.is_connect() || error.is_timeout();
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

#[derive(Default)]
pub struct Engine {
    schedule: tokio::sync::Mutex<(
        Option<tokio::time::Instant>,
        std::collections::HashMap<String, tokio::time::Instant>,
    )>,
}
impl Engine {
    async fn wait_turn(&self, host: String) {
        loop {
            let mut state = self.schedule.lock().await;
            let now = tokio::time::Instant::now();
            let at = now
                .max(state.0.unwrap_or(now))
                .max(*state.1.get(&host).unwrap_or(&now));
            if at > now {
                drop(state);
                tokio::time::sleep_until(at).await;
                // Recheck after waking: timers can run late, and another worker
                // may have started in the meantime. Book from the actual start.
                continue;
            }
            state.0 = Some(now + Duration::from_millis(500));
            state.1.insert(host, now + Duration::from_secs(1));
            return;
        }
    }
    pub async fn discover(
        &self,
        job_id: String,
        username: &str,
        mode: &str,
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
        let total = registry::source_count(mode);
        if total == 0 {
            return Err("Unsupported search mode".into());
        }
        let client =
            http_client(timeout).map_err(|_| "Could not initialize the secure HTTP client.")?;
        let semaphore = tokio::sync::Semaphore::new(2);
        let mut pending = FuturesUnordered::new();
        for site in [
            Site::GitHub,
            Site::DevCommunity,
            Site::Codeberg,
            Site::Lichess,
            Site::Chess,
        ]
        .into_iter()
        .take(total)
        {
            let client = &client;
            let semaphore = &semaphore;
            pending.push(async move {
                let _permit = semaphore
                    .acquire()
                    .await
                    .expect("local semaphore stays open");
                let host = reqwest::Url::parse(&site.endpoint(username))
                    .expect("bundled endpoint")
                    .host_str()
                    .unwrap()
                    .to_owned();
                self.wait_turn(host.clone()).await;
                let first=check_site(client,site,username).await;
                if first.retryable {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    self.wait_turn(host).await;
                    let mut second=check_site(client,site,username).await;
                    second.evidence.push("One controlled retry followed a transient network or server failure; no further retries were made.".into());
                    second
                } else { first }
            });
        }
        let mut summary = SearchSummary {
            job_id,
            findings: Vec::new(),
            canceled: false,
            warnings: Vec::new(),
            total,
        };
        loop {
            tokio::select! {
                biased;
                _=cancellation.cancelled()=>{summary.canceled=true;break;}
                result=pending.next()=>{
                    let Some(finding)=result else {break};
                    summary.findings.push(finding.clone());
                    on_update(SearchUpdate{job_id:summary.job_id.clone(),finding,completed:summary.findings.len(),total});
                }
            }
        }
        Ok(summary)
    }
}
pub async fn discover(
    job_id: String,
    username: &str,
    timeout: u64,
    cancellation: CancellationToken,
    on_update: impl FnMut(SearchUpdate),
) -> Result<SearchSummary, String> {
    Engine::default()
        .discover(job_id, username, "quick", timeout, cancellation, on_update)
        .await
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

#[cfg(test)]
mod connector_tests {
    use super::*;
    #[test]
    fn new_connectors_require_multiple_signals() {
        for (site, body) in [
            (
                Site::Codeberg,
                r#"{"id":22,"login":"octocat","html_url":"https://codeberg.org/octocat"}"#,
            ),
            (
                Site::Lichess,
                r#"{"id":"octocat","username":"octocat","url":"https://lichess.org/@/octocat","createdAt":123456}"#,
            ),
            (
                Site::Chess,
                r#"{"player_id":22,"username":"octocat","url":"https://www.chess.com/member/octocat"}"#,
            ),
        ] {
            assert_eq!(
                classify(site, "octocat", 200, "application/json", body).0,
                ResultStatus::Confirmed
            );
            assert_eq!(
                classify(site, "other", 200, "application/json", body).0,
                ResultStatus::Inconclusive
            );
            assert_eq!(
                classify(site, "octocat", 200, "application/json", "{}").0,
                ResultStatus::Inconclusive
            );
            assert_eq!(
                classify(site, "octocat", 429, "text/html", "").0,
                ResultStatus::Blocked
            );
            assert_eq!(
                classify(site, "octocat", 404, "text/html", "").0,
                ResultStatus::Inconclusive
            );
        }
    }
    #[test]
    fn missing_accounts_require_expected_error_data() {
        for (site, body) in [
            (Site::Codeberg, r#"{"message":"user does not exist"}"#),
            (Site::Lichess, r#"{"error":"Not found"}"#),
            (Site::Chess, r#"{"message":"Player not found"}"#),
        ] {
            assert_eq!(
                classify(site, "missing", 404, "application/json", body).0,
                ResultStatus::NotFound
            );
        }
    }
    #[tokio::test(start_paused = true)]
    async fn scheduling_limits_domains_and_global_starts() {
        let engine = std::sync::Arc::new(Engine::default());
        let start = tokio::time::Instant::now();
        engine.wait_turn("a".into()).await;
        let worker = engine.clone();
        let delayed = tokio::spawn(async move { worker.wait_turn("a".into()).await });
        tokio::task::yield_now().await;
        // Reproduce an OS scheduling delay after a timer's nominal deadline.
        tokio::time::advance(Duration::from_millis(1040)).await;
        delayed.await.unwrap();
        assert!(start.elapsed() >= Duration::from_secs(1));
        let next = tokio::time::Instant::now();
        engine.wait_turn("b".into()).await;
        assert!(next.elapsed() >= Duration::from_millis(500));
    }
}
