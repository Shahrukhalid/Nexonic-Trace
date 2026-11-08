//! Licensed indexes: bounded pagination and metadata-only dark-web discovery.
//! No leaked documents, snippets, passwords or third-party entities are returned.
use crate::{http_client, security, Finding, PublicField, ResultStatus};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use reqwest::{header::HeaderValue, RequestBuilder};
use serde::Deserialize;
use sha1::Sha1;
use std::{collections::HashSet, time::Duration};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

pub enum IndexProvider<'a> {
    Brave(&'a str),
    DarkOwl { public: &'a str, private: &'a str },
}
pub struct IndexResults {
    pub findings: Vec<Finding>,
    pub warnings: Vec<String>,
    pub canceled: bool,
}

pub fn valid_query(query: &str) -> bool {
    security::valid_email(query)
        || regex::Regex::new(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$")
            .unwrap()
            .is_match(query)
}
fn sensitive(value: &str) -> Result<HeaderValue, String> {
    let mut value = HeaderValue::from_str(value).map_err(|_| "Invalid provider credential.")?;
    value.set_sensitive(true);
    Ok(value)
}
/// The provider requires HMAC-SHA1 over the UNENCODED path (not password hashing).
fn owl_authorization(
    public: &str,
    private: &str,
    path: &str,
    date: &str,
) -> Result<HeaderValue, String> {
    let mut mac = Hmac::<Sha1>::new_from_slice(private.as_bytes())
        .map_err(|_| "Invalid provider credential.")?;
    mac.update(b"GET");
    mac.update(path.as_bytes());
    mac.update(date.as_bytes());
    let signature = STANDARD.encode(mac.finalize().into_bytes());
    sensitive(&Zeroizing::new(format!("OWL {public}:{signature}")))
}
fn request(
    client: &reqwest::Client,
    provider: &IndexProvider<'_>,
    query: &str,
    page: usize,
) -> Result<RequestBuilder, String> {
    match provider {
        IndexProvider::Brave(key) => Ok(client
            .get("https://api.search.brave.com/res/v1/web/search")
            .query(&[
                ("q", format!("\"{query}\"")),
                ("count", "20".into()),
                ("country", "ALL".into()),
                ("spellcheck", "false".into()),
                ("result_filter", "web".into()),
                ("offset", page.to_string()),
                ("text_decorations", "false".into()),
            ])
            .header("X-Subscription-Token", sensitive(key)?)),
        IndexProvider::DarkOwl { public, private } => {
            let field = if security::valid_email(query) {
                "email"
            } else {
                "q"
            };
            let term = if field == "email" {
                query.to_owned()
            } else {
                format!("exact:{query}")
            };
            let pairs = [
                (field, term),
                ("offset", (page * 20).to_string()),
                ("count", "20".into()),
                ("detail", "nonbody".into()),
                ("req", "false".into()),
                ("highlight", "false".into()),
                ("similar", "false".into()),
            ];
            let path = "/api/v1/search?".to_owned()
                + &pairs
                    .iter()
                    .map(|(k, v)| format!("{k}={v}"))
                    .collect::<Vec<_>>()
                    .join("&");
            let date = Utc::now().format("%a, %d %b %Y %H:%M:%S GMT").to_string();
            Ok(client
                .get("https://api.darkowl.com/api/v1/search")
                .query(&pairs)
                .header(
                    "Authorization",
                    owl_authorization(public, private, &path, &date)?,
                )
                .header("Date", date))
        }
    }
}

#[derive(Deserialize)]
struct OwlPage {
    total: u64,
    results: Vec<OwlRecord>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwlRecord {
    id: String,
    network: Option<String>,
    crawl_date: Option<String>,
}

pub fn parse_darkowl(body: &str, page: usize) -> Result<(Vec<Finding>, bool), String> {
    // Unknown JSON fields (including bodies, snippets, titles, URLs, other users'
    // emails and leak download links) are ignored, never copied into app state.
    let data: OwlPage =
        serde_json::from_str(body).map_err(|_| "Invalid dark-web provider metadata.")?;
    if data.results.len() > 20 {
        return Err("Dark-web provider exceeded its page limit.".into());
    }
    let more = !data.results.is_empty() && (((page + 1) * 20) as u64) < data.total;
    let mut seen = HashSet::new();
    let mut findings = Vec::new();
    for result in data.results {
        if !(16..=80).contains(&result.id.len())
            || !result
                .id
                .bytes()
                .all(|b| b.is_ascii_hexdigit() || b == b'-')
        {
            return Err("Dark-web provider returned an invalid record identifier.".into());
        }
        if !seen.insert(result.id.clone()) {
            continue;
        }
        let network = match result.network.as_deref() {
            Some("onion.v2" | "onion.v3") => "Tor",
            Some("i2p") => "I2P",
            Some("telegram") => "Telegram",
            Some("discord") => "Discord",
            Some("irc") => "IRC",
            Some("ftp") => "FTP",
            Some("zeronet") => "ZeroNet",
            _ => "Other indexed source",
        };
        let mut fields = vec![
            PublicField {
                label: "Provider record ID".into(),
                value: result.id.clone(),
            },
            PublicField {
                label: "Network".into(),
                value: network.into(),
            },
        ];
        if let Some(date) = result
            .crawl_date
            .and_then(|v| DateTime::parse_from_rfc3339(&v).ok())
        {
            fields.push(PublicField {
                label: "Collected".into(),
                value: date.format("%Y-%m-%d").to_string(),
            });
        }
        findings.push(Finding{site:format!("DarkOwl · {}",result.id),category:"Dark-web index mention".into(),url:String::new(),
            status:ResultStatus::Inconclusive,checked_at:Utc::now().to_rfc3339(),public_fields:fields,
            evidence:vec![format!("DarkOwl returned a matching indexed record from {network}. Review the record ID in your licensed provider account. A mention does not prove account ownership or an exposed email/password pair. Leaked documents were not requested. Download links and unrelated entity fields were discarded.")],request_outcome:"completed".into(),retryable:false});
    }
    Ok((findings, more))
}
fn parse_brave(body: &str) -> Result<(Vec<Finding>, bool), String> {
    let data: serde_json::Value =
        serde_json::from_str(body).map_err(|_| "Invalid search-provider data.")?;
    // Brave can legitimately omit `web` when no matches exist.
    let findings = if data.get("web").is_none() && data.get("query").is_some() {
        Vec::new()
    } else {
        security::parse_public_search(body)?
    };
    let more = data
        .pointer("/query/more_results_available")
        .and_then(|v| v.as_bool())
        == Some(true);
    Ok((findings, more))
}
fn append_unique(
    all: &mut Vec<Finding>,
    found: Vec<Finding>,
    seen: &mut HashSet<String>,
    limit: usize,
) {
    for finding in found {
        let id = if finding.url.is_empty() {
            finding.site.clone()
        } else {
            finding.url.clone()
        };
        if all.len() < limit && seen.insert(id) {
            all.push(finding);
        }
    }
}
pub async fn search(
    query: &str,
    provider: IndexProvider<'_>,
    limit: usize,
    token: &CancellationToken,
) -> Result<IndexResults, String> {
    if !valid_query(query) || ![20, 60, 100].contains(&limit) {
        return Err("Enter a valid username or email and search depth.".into());
    }
    let client = http_client(20).map_err(|_| "Could not create the secure client.")?;
    collect(limit, token, |page| {
        let client = &client;
        let provider = &provider;
        async move {
            if page > 0 {
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            let response = request(client, provider, query, page)?
                .send()
                .await
                .map_err(|_| "Index provider unavailable.".to_string())?;
            let (status, body) = security::bounded_body(response).await?;
            let body = Zeroizing::new(body);
            if status != 200 {
                return Err(security::provider_error(status));
            }
            match provider {
                IndexProvider::Brave(_) => parse_brave(&body),
                IndexProvider::DarkOwl { .. } => parse_darkowl(&body, page),
            }
        }
    })
    .await
}

async fn collect<F, Fut>(
    limit: usize,
    token: &CancellationToken,
    mut fetch: F,
) -> Result<IndexResults, String>
where
    F: FnMut(usize) -> Fut,
    Fut: std::future::Future<Output = Result<(Vec<Finding>, bool), String>>,
{
    let mut results = IndexResults {
        findings: Vec::new(),
        warnings: Vec::new(),
        canceled: false,
    };
    let mut seen = HashSet::new();
    for page in 0..limit / 20 {
        let next = async { fetch(page).await };
        let outcome = tokio::select! {biased;_=token.cancelled()=>{results.canceled=true;break;},value=next=>value};
        match outcome {
            Ok((found, more)) => {
                append_unique(&mut results.findings, found, &mut seen, limit);
                if !more || results.findings.len() >= limit {
                    break;
                }
            }
            Err(error) => {
                if page == 0 {
                    return Err(error);
                }
                results
                    .warnings
                    .push(format!("Partial index results: {error}"));
                break;
            }
        }
    }
    if results.canceled {
        results
            .warnings
            .push("Search canceled. Any returned records are partial.".into());
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn metadata_discards_passwords_bodies_other_people_and_unsafe_links() {
        let body = r#"{"total":1,"results":[{"id":"0e9ac6f94d83c305a317b33eb60c091158bbbbb0","network":"onion.v3","crawlDate":"2025-07-20T16:58:59Z","title":"secret-title","body":"leaked-password","snippet":"another-secret","emails":["other@example.org"],"leak":{"downloadLocations":["http://bad.onion/dump"]}}]}"#;
        let (found, more) = parse_darkowl(body, 0).unwrap();
        assert_eq!(found.len(), 1);
        assert!(!more);
        assert_eq!(found[0].status, ResultStatus::Inconclusive);
        assert!(found[0].url.is_empty());
        let json = serde_json::to_string(&found).unwrap();
        for text in [
            "secret-title",
            "leaked-password",
            "another-secret",
            "other@example.org",
            "bad.onion",
        ] {
            assert!(!json.contains(text));
        }
        assert!(json.contains("Tor"));
        assert!(json.contains("2025-07-20"));
    }
    #[test]
    fn darkowl_rejects_invalid_envelopes_and_sanitizes_fields() {
        for body in ["{}", r#"{"results":[]}"#, r#"{"total":0,"results":null}"#] {
            assert!(parse_darkowl(body, 0).is_err());
        }
        assert!(parse_darkowl(
            r#"{"total":1,"results":[{"id":"not-an-opaque-record-id"}]}"#,
            0
        )
        .is_err());
        let (found,_)=parse_darkowl(r#"{"total":1,"results":[{"id":"abcdef1234567890","network":"password-injected","crawlDate":"secret"}]}"#,0).unwrap();
        assert_eq!(found.len(), 1);
        let json = serde_json::to_string(&found).unwrap();
        assert!(!json.contains("injected"));
        assert!(!json.contains("secret"));
    }
    #[test]
    fn query_and_requests_cannot_inject_search_operators_or_content_options() {
        for q in ["x OR y", "*", "a\n", "a&detail=full", "https://example.org"] {
            assert!(!valid_query(q));
        }
        let client = http_client(20).unwrap();
        let req = request(
            &client,
            &IndexProvider::DarkOwl {
                public: "publicfixture",
                private: "privatefixture",
            },
            "person+tag@example.org",
            1,
        )
        .unwrap()
        .build()
        .unwrap();
        let pairs: std::collections::HashMap<_, _> = req.url().query_pairs().collect();
        assert_eq!(pairs["email"], "person+tag@example.org");
        assert_eq!(pairs["detail"], "nonbody");
        assert_eq!(pairs["offset"], "20");
        assert_eq!(pairs["highlight"], "false");
        assert!(req.headers()["Authorization"].is_sensitive());
        assert!(!req.url().as_str().contains("privatefixture"));
        let req = request(&client, &IndexProvider::Brave("fixture-key"), "username", 2)
            .unwrap()
            .build()
            .unwrap();
        assert!(req.headers()["X-Subscription-Token"].is_sensitive());
        assert!(req.url().as_str().contains("offset=2"));
        assert!(req.url().as_str().contains("country=ALL"));
        assert!(req.url().as_str().contains("spellcheck=false"));
    }
    #[test]
    fn hmac_matches_independent_provider_protocol_vector() {
        let value = owl_authorization(
            "publicfixture",
            "privatefixture",
            "/api/v1/search?q=exact:user&detail=nonbody",
            "Sun, 08 Nov 2026 00:00:00 GMT",
        )
        .unwrap();
        assert_eq!(
            value.to_str().unwrap(),
            "OWL publicfixture:HAguUpGPP3o40BJAdG7FAV1uKLA="
        );
    }
    #[test]
    fn pagination_requires_explicit_more_and_deduplicates_across_pages() {
        assert!(
            !parse_brave(r#"{"query":{},"web":{"results":[]}}"#)
                .unwrap()
                .1
        );
        assert!(
            parse_brave(r#"{"query":{"more_results_available":true},"web":{"results":[]}}"#)
                .unwrap()
                .1
        );
        let page = || {
            security::parse_public_search(
                r#"{"web":{"results":[{"url":"https://example.org/a"}]}}"#,
            )
            .unwrap()
        };
        let mut found = vec![];
        let mut seen = HashSet::new();
        append_unique(&mut found, page(), &mut seen, 100);
        append_unique(&mut found, page(), &mut seen, 100);
        assert_eq!(found.len(), 1);
        assert!(parse_brave("{}").is_err());
        assert!(parse_brave(r#"{"query":{}}"#).unwrap().0.is_empty());
    }
    #[tokio::test]
    async fn partial_pages_survive_provider_failure_and_cancel() {
        let page = || {
            security::parse_public_search(
                r#"{"web":{"results":[{"url":"https://example.org/a"}]}}"#,
            )
            .unwrap()
        };
        let token = CancellationToken::new();
        let mut calls = 0;
        let result = collect(100, &token, |index| {
            calls += 1;
            std::future::ready(if index == 0 {
                Ok((page(), true))
            } else {
                Err("rate limited".into())
            })
        })
        .await
        .unwrap();
        assert_eq!(calls, 2);
        assert_eq!(result.findings.len(), 1);
        assert_eq!(result.warnings.len(), 1);
        assert!(!result.canceled);
        let result = collect(100, &token, |_| {
            token.cancel();
            std::future::ready(Ok((page(), true)))
        })
        .await
        .unwrap();
        assert!(result.canceled);
        assert_eq!(result.findings.len(), 1);
        assert!(
            collect(20, &CancellationToken::new(), |_| std::future::ready(Err(
                "unavailable".into()
            )))
            .await
            .is_err()
        );
    }
    #[tokio::test]
    async fn precanceled_search_makes_no_network_request() {
        let token = CancellationToken::new();
        token.cancel();
        let result = search(
            "fixture",
            IndexProvider::Brave("not-a-real-key"),
            100,
            &token,
        )
        .await
        .unwrap();
        assert!(result.canceled);
        assert!(result.findings.is_empty());
    }
}
