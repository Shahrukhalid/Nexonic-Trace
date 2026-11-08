use crate::data::{Preferences, SavedScan, Store};
use std::time::{Duration, Instant};
use tauri::State;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use trace_core::security::{Breach, PasswordCheck};
use zeroize::Zeroizing;

#[derive(Default)]
struct Keys {
    brave: Zeroizing<String>,
    hibp: Zeroizing<String>,
}
pub struct Features {
    pub store: Mutex<Store>,
    keys: Mutex<Keys>,
    last_call: Mutex<Option<Instant>>,
    web_job: Mutex<Option<(String, CancellationToken)>>,
}
impl Features {
    pub fn new(store: Store) -> Self {
        Self {
            store: Mutex::new(store),
            keys: Mutex::new(Keys::default()),
            last_call: Mutex::new(None),
            web_job: Mutex::new(None),
        }
    }
    pub async fn cancel_web(&self, id: &str) {
        if let Some((job, token)) = &*self.web_job.lock().await {
            if job == id {
                token.cancel();
            }
        }
    }
    async fn rate_limit(&self) -> Result<(), String> {
        let mut last = self.last_call.lock().await;
        if last.is_some_and(|last| last.elapsed() < Duration::from_secs(2)) {
            return Err("Wait two seconds between provider checks.".into());
        }
        *last = Some(Instant::now());
        Ok(())
    }
}
#[tauri::command]
pub async fn get_preferences(state: State<'_, Features>) -> Result<Preferences, String> {
    state.store.lock().await.preferences()
}
#[tauri::command]
pub async fn set_preferences(
    state: State<'_, Features>,
    preferences: Preferences,
) -> Result<(), String> {
    state.store.lock().await.set_preferences(preferences)
}
#[tauri::command]
pub async fn list_scans(state: State<'_, Features>) -> Result<Vec<SavedScan>, String> {
    state.store.lock().await.scans()
}
#[tauri::command]
pub async fn delete_scan(state: State<'_, Features>, id: String) -> Result<(), String> {
    state.store.lock().await.delete_scan(&id)
}
#[tauri::command]
pub async fn clear_history(state: State<'_, Features>) -> Result<(), String> {
    state.store.lock().await.clear(false)
}
#[tauri::command]
pub async fn delete_all_data(state: State<'_, Features>) -> Result<(), String> {
    *state.keys.lock().await = Keys::default();
    state.store.lock().await.clear(true)
}
#[tauri::command]
pub async fn configure_provider(
    state: State<'_, Features>,
    provider: String,
    key: String,
    accept_costs: bool,
) -> Result<(), String> {
    let key = Zeroizing::new(key);
    if !key.is_empty()
        && (!accept_costs
            || key.len() < 8
            || key.len() > 512
            || !key.is_ascii()
            || key.chars().any(char::is_control))
    {
        return Err("A valid key and explicit provider-cost consent are required.".into());
    }
    let mut keys = state.keys.lock().await;
    match provider.as_str() {
        "brave" => keys.brave = key,
        "hibp" => keys.hibp = key,
        _ => return Err("Unsupported provider.".into()),
    };
    Ok(())
}
#[tauri::command]
pub async fn provider_status(state: State<'_, Features>) -> Result<(bool, bool), String> {
    let keys = state.keys.lock().await;
    Ok((!keys.brave.is_empty(), !keys.hibp.is_empty()))
}
#[tauri::command]
pub async fn password_check(
    state: State<'_, Features>,
    password: String,
) -> Result<PasswordCheck, String> {
    let password = Zeroizing::new(password);
    state.rate_limit().await?;
    trace_core::security::check_password(password).await
}
#[tauri::command]
pub async fn public_web_search(
    state: State<'_, Features>,
    query: String,
    job_id: String,
    mode: String,
) -> Result<trace_core::SearchSummary, String> {
    if job_id.is_empty() || job_id.len() > 64 {
        return Err("Invalid search identifier.".into());
    }
    let limit = match mode.as_str() {
        "quick" => 3,
        "deep" => 6,
        "comprehensive" => 10,
        _ => return Err("Unsupported search mode.".into()),
    };
    let key = state.keys.lock().await.brave.clone();
    if key.is_empty() {
        return Err("No provider is connected. Add a Brave Search key in Settings; provider charges may apply.".into());
    }
    state.rate_limit().await?;
    let token = CancellationToken::new();
    {
        let mut job = state.web_job.lock().await;
        if job.is_some() {
            return Err("A public-web search is already running.".into());
        }
        *job = Some((job_id.clone(), token.clone()));
    }
    let result = tokio::select! {biased;_=token.cancelled()=>Ok(None),result=trace_core::security::public_search(&query,&key,limit)=>result.map(Some)};
    *state.web_job.lock().await = None;
    let result = result?;
    let canceled = result.is_none();
    let findings = result.unwrap_or_default();
    let mut summary = trace_core::SearchSummary {
        job_id,
        total: findings.len(),
        findings,
        canceled,
        warnings: vec![],
    };
    if let Err(error) =
        state
            .store
            .lock()
            .await
            .record(&query, &format!("public_web_{mode}"), &summary)
    {
        summary.warnings.push(error);
    }
    Ok(summary)
}
#[tauri::command]
pub async fn breach_check(
    state: State<'_, Features>,
    email: String,
    authorized: bool,
) -> Result<Vec<Breach>, String> {
    if email.ends_with("@hibp-integration-tests.com") {
        return Err("Integration-test addresses are not displayed as real exposure. Use the explicit development security probe for provider fixtures.".into());
    }
    if !authorized {
        return Err("Confirm that you own this address or have permission to check it.".into());
    }
    state.rate_limit().await?;
    let key = state.keys.lock().await.hibp.clone();
    if key.is_empty() {
        return Err(
            "No licensed breach provider is connected. Add a Have I Been Pwned key in Settings."
                .into(),
        );
    }
    trace_core::security::email_breaches(&email, &key).await
}
