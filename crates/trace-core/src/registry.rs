//! Declarative connector rules. Every bundled rule states how an official
//! public API proves that a profile exists and how it reports a missing one.
//! Field paths are dotted JSON paths; numeric segments index arrays.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::OnceLock;

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
    pub verify: Verify,
    #[serde(default)]
    pub public_fields: Vec<PublicFieldRule>,
    pub redirects: String,
    pub requests_per_second: u32,
    pub timeout_seconds: u64,
    pub reliability: String,
    pub last_verified: Option<String>,
    pub priority: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Verify {
    /// Field that must hold the queried username.
    pub username_field: String,
    /// "caseInsensitive", "exact", or "mediawiki" (first letter case-folded, underscores as spaces).
    pub username_match: String,
    /// Appended to the query before comparison (for handles such as name.bsky.social).
    #[serde(default)]
    pub username_suffix: String,
    /// Provider-specific account identifier.
    pub id_field: String,
    /// "positiveNumber", "numericString" or "nonEmptyString".
    pub id_kind: String,
    /// Field that must equal the generated profile URL (case-insensitive).
    #[serde(default)]
    pub profile_field: Option<String>,
    #[serde(default)]
    pub required: Vec<FieldRule>,
    pub not_found: NotFound,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FieldRule {
    pub field: String,
    #[serde(default)]
    pub one_of: Vec<String>,
    #[serde(default)]
    pub prefix: Option<String>,
    /// The field must equal the query (case-insensitive).
    #[serde(default)]
    pub equals_query: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotFound {
    pub status: u16,
    /// "message" (field contains text), "null" (body is JSON null),
    /// "emptyArray" (the body, or `field` when given, is []), or "present" (field exists).
    pub kind: String,
    #[serde(default)]
    pub field: Option<String>,
    #[serde(default)]
    pub contains: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicFieldRule {
    pub field: String,
    pub label: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Registry {
    pub version: u32,
    pub sites: Vec<Rule>,
}

/// Hosts a bundled rule may contact. A rule outside this list fails validation.
pub const ALLOWED_HOSTS: &[&str] = &[
    "github.com",
    "api.github.com",
    "dev.to",
    "codeberg.org",
    "lichess.org",
    "www.chess.com",
    "api.chess.com",
    "gitlab.com",
    "gitlab.gnome.org",
    "invent.kde.org",
    "gitea.com",
    "bitbucket.org",
    "api.bitbucket.org",
    "news.ycombinator.com",
    "hacker-news.firebaseio.com",
    "crates.io",
    "hex.pm",
    "mastodon.social",
    "fosstodon.org",
    "infosec.exchange",
    "mstdn.social",
    "bsky.app",
    "public.api.bsky.app",
    "lemmy.world",
    "lemmy.ml",
    "programming.dev",
    "www.speedrun.com",
    "huggingface.co",
    "codeforces.com",
    "en.wikipedia.org",
    "meta.wikimedia.org",
    "community.fandom.com",
    "monkeytype.com",
    "api.monkeytype.com",
    "www.codewars.com",
    "www.mixcloud.com",
    "api.mixcloud.com",
];

pub fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        validate_registry(include_str!("../rules/sites.json"))
            .expect("bundled rule registry must validate")
    })
}

/// Sources checked per mode, highest priority first.
pub fn source_count(mode: &str) -> usize {
    let all = registry().sites.len();
    match mode {
        "quick" => all.min(10),
        "deep" => all.min(20),
        "comprehensive" => all,
        _ => 0,
    }
}

pub fn ordered() -> Vec<&'static Rule> {
    let mut rules: Vec<&Rule> = registry().sites.iter().collect();
    rules.sort_by_key(|r| (r.priority, r.id.clone()));
    rules
}

/// Resolves a dotted path such as `query.users.0.name`.
pub fn lookup<'a>(data: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.')
        .filter(|s| !s.is_empty())
        .try_fold(data, |v, seg| match seg.parse::<usize>() {
            Ok(i) if v.is_array() => v.get(i),
            _ => v.get(seg),
        })
}

fn valid_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 80
        && path.split('.').all(|s| {
            !s.is_empty()
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        })
}

pub fn validate_registry(data: &str) -> Result<Registry, String> {
    let registry: Registry =
        serde_json::from_str(data).map_err(|e| format!("Invalid registry structure: {e}"))?;
    if registry.version != 2 || registry.sites.is_empty() || registry.sites.len() > 150 {
        return Err("Unsupported registry version or size".into());
    }
    let mut ids = HashSet::new();
    for rule in &registry.sites {
        let v = &rule.verify;
        let nf = &v.not_found;
        let fields_ok = valid_path(&v.username_field)
            && valid_path(&v.id_field)
            && v.profile_field.as_deref().is_none_or(valid_path)
            && v.required.iter().all(|f| {
                valid_path(&f.field)
                    && (!f.one_of.is_empty() || f.prefix.is_some() || f.equals_query)
            })
            && nf.field.as_deref().is_none_or(valid_path)
            && rule
                .public_fields
                .iter()
                .all(|f| valid_path(&f.field) && !f.label.is_empty());
        let not_found_ok = match nf.kind.as_str() {
            "message" => {
                nf.field.is_some() && nf.contains.as_deref().is_some_and(|c| !c.is_empty())
            }
            "present" => nf.field.is_some(),
            "null" | "emptyArray" => nf.status == 200,
            _ => false,
        } && (nf.status == 200 || (400..500).contains(&nf.status))
            && !matches!(nf.status, 401 | 403 | 429);
        if !ids.insert(&rule.id)
            || !rule
                .id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'.')
            || rule.method != "GET"
            || rule.redirects != "refuse"
            || rule.requests_per_second != 1
            || !(5..=30).contains(&rule.timeout_seconds)
            || !["caseInsensitive", "exact", "mediawiki"].contains(&v.username_match.as_str())
            || !["positiveNumber", "numericString", "nonEmptyString"].contains(&v.id_kind.as_str())
            || !fields_ok
            || !not_found_ok
            || regex::Regex::new(&rule.username_pattern).is_err()
            || !rule.username_pattern.starts_with('^')
            || !rule.username_pattern.ends_with('$')
        {
            return Err(format!("Unsafe or invalid connector rule: {}", rule.id));
        }
        for pattern in [&rule.profile_url, &rule.api_url] {
            if pattern.matches("{username}").count() != 1 {
                return Err(format!("Invalid URL template: {}", rule.id));
            }
            let url = reqwest::Url::parse(&pattern.replace("{username}", "test"))
                .map_err(|_| "Invalid URL")?;
            if url.scheme() != "https"
                || !ALLOWED_HOSTS.contains(&url.host_str().unwrap_or(""))
                || url.port().is_some()
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err(format!("Unsafe rule destination: {}", rule.id));
            }
        }
    }
    Ok(registry)
}

#[cfg(test)]
mod tests {
    use super::*;
    const BUNDLED: &str = include_str!("../rules/sites.json");
    #[test]
    fn bundled_registry_validates() {
        assert_eq!(validate_registry(BUNDLED).unwrap().sites.len(), 30);
    }
    #[test]
    fn refuses_untrusted_destinations() {
        let data = BUNDLED.replace("https://api.github.com", "https://127.0.0.1");
        assert!(validate_registry(&data).is_err());
        let data = BUNDLED.replace("https://gitlab.com/api", "http://gitlab.com/api");
        assert!(validate_registry(&data).is_err());
    }
    #[test]
    fn refuses_unanchored_patterns_and_weak_not_found_rules() {
        assert!(
            validate_registry(&BUNDLED.replacen("\"^[A-Za-z0-9]", "\"[A-Za-z0-9]", 1)).is_err()
        );
        assert!(
            validate_registry(&BUNDLED.replacen("\"status\": 404", "\"status\": 403", 1)).is_err()
        );
    }
    #[test]
    fn modes_have_real_distinct_coverage() {
        assert_eq!(source_count("quick"), 10);
        assert_eq!(source_count("deep"), 20);
        assert_eq!(source_count("comprehensive"), 30);
        assert_eq!(source_count("other"), 0);
    }
    #[test]
    fn paths_index_objects_and_arrays() {
        let v: Value = serde_json::from_str(r#"{"a":[{"b":"x"}]}"#).unwrap();
        assert_eq!(lookup(&v, "a.0.b").and_then(Value::as_str), Some("x"));
        assert!(lookup(&v, "a.1.b").is_none());
    }
}
