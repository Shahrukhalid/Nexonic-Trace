use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rule {
    pub id: String,
    pub name: String,
    pub category: String,
    pub profile_url: String,
    pub api_url: String,
    pub method: String,
    pub username_pattern: String,
    pub positive_signals: Vec<String>,
    pub negative_signals: Vec<String>,
    pub redirects: String,
    pub requests_per_second: u32,
    pub timeout_seconds: u64,
    pub reliability: String,
    pub last_verified: Option<String>,
    pub priority: u32,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Registry {
    pub version: u32,
    pub sites: Vec<Rule>,
}
pub fn registry() -> Registry {
    serde_json::from_str(include_str!("../rules/sites.json"))
        .expect("bundled rule registry must validate")
}
pub fn source_count(mode: &str) -> usize {
    match mode {
        "quick" => 2,
        "deep" => 4,
        "comprehensive" => registry().sites.len(),
        _ => 0,
    }
}
pub fn validate_registry(data: &str) -> Result<Registry, String> {
    let registry: Registry =
        serde_json::from_str(data).map_err(|_| "Invalid registry structure")?;
    if registry.version != 1 || registry.sites.is_empty() || registry.sites.len() > 100 {
        return Err("Unsupported registry version or size".into());
    }
    let mut ids = HashSet::new();
    for rule in &registry.sites {
        if !ids.insert(&rule.id)
            || !["github", "dev", "codeberg", "lichess", "chess"].contains(&rule.id.as_str())
            || rule.method != "GET"
            || rule.redirects != "refuse"
            || rule.requests_per_second != 1
            || !(5..=30).contains(&rule.timeout_seconds)
            || rule.positive_signals.is_empty()
            || rule.negative_signals.is_empty()
            || regex::Regex::new(&rule.username_pattern).is_err()
        {
            return Err("Unsafe or invalid connector rule".into());
        }
        let hosts = [
            "github.com",
            "api.github.com",
            "dev.to",
            "codeberg.org",
            "lichess.org",
            "www.chess.com",
            "api.chess.com",
        ];
        for pattern in [&rule.profile_url, &rule.api_url] {
            if pattern.matches("{username}").count() != 1 {
                return Err("Invalid URL template".into());
            }
            let url = reqwest::Url::parse(&pattern.replace("{username}", "test"))
                .map_err(|_| "Invalid URL")?;
            if url.scheme() != "https"
                || !hosts.contains(&url.host_str().unwrap_or(""))
                || url.port().is_some()
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err("Unsafe rule destination".into());
            }
        }
    }
    Ok(registry)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bundled_registry_validates() {
        assert_eq!(
            validate_registry(include_str!("../rules/sites.json"))
                .unwrap()
                .sites
                .len(),
            5
        );
    }
    #[test]
    fn refuses_untrusted_destinations() {
        let data = include_str!("../rules/sites.json")
            .replace("https://api.github.com", "https://127.0.0.1");
        assert!(validate_registry(&data).is_err());
    }
    #[test]
    fn modes_have_real_distinct_coverage() {
        assert_eq!(source_count("quick"), 2);
        assert_eq!(source_count("deep"), 4);
        assert_eq!(source_count("comprehensive"), 5);
    }
}
