mod data;
mod features;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use trace_core::{SearchSummary, SearchUpdate};

#[derive(Default)]
struct SearchState {
    active: Mutex<Option<(String, CancellationToken)>>,
    last_start: Mutex<Option<Instant>>,
    engine: trace_core::Engine,
}

#[tauri::command]
async fn start_search(
    state: tauri::State<'_, SearchState>,
    features: tauri::State<'_, features::Features>,
    job_id: String,
    query: String,
    mode: String,
    timeout_seconds: u64,
    on_update: Channel<SearchUpdate>,
) -> Result<SearchSummary, String> {
    if !["quick", "deep", "comprehensive"].contains(&mode.as_str()) {
        return Err("Unsupported search mode.".into());
    }
    if job_id.len() > 64 || job_id.is_empty() || !trace_core::valid_query(&query) {
        return Err("Invalid search request.".into());
    }
    let token = CancellationToken::new();
    {
        let mut active = state.active.lock().await;
        if active.is_some() {
            return Err("A search is already running.".into());
        }
        let mut last = state.last_start.lock().await;
        if last.is_some_and(|time| time.elapsed() < Duration::from_secs(2)) {
            return Err("Please wait two seconds between searches.".into());
        }
        *last = Some(Instant::now());
        *active = Some((job_id.clone(), token.clone()));
    }
    let mut result = state
        .engine
        .discover(
            job_id.clone(),
            &query,
            &mode,
            timeout_seconds,
            token,
            |update| {
                let _ = on_update.send(update);
            },
        )
        .await;
    if let Ok(summary) = &mut result {
        if let Err(error) = features.store.lock().await.record(&query, &mode, summary) {
            summary.warnings.push(error);
        }
    }
    let mut active = state.active.lock().await;
    if active.as_ref().is_some_and(|(id, _)| id == &job_id) {
        *active = None;
    }
    result
}

#[tauri::command]
async fn cancel_search(
    state: tauri::State<'_, SearchState>,
    features: tauri::State<'_, features::Features>,
    job_id: String,
) -> Result<(), String> {
    features.cancel_web(&job_id).await;
    if let Some((id, token)) = &*state.active.lock().await {
        if id == &job_id {
            token.cancel();
        }
    }
    Ok(())
}

#[tauri::command]
fn open_source(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = if trace_core::security::public_source_url(&url) {
        url
    } else {
        reqwest_url(&url)?
    };
    app.opener()
        .open_url(parsed, None::<&str>)
        .map_err(|_| "Could not open the source in your browser.".into())
}

fn reqwest_url(url: &str) -> Result<String, String> {
    // Only generated profile URLs with a supported username can leave the app.
    for prefix in [
        "https://github.com/",
        "https://dev.to/",
        "https://codeberg.org/",
        "https://lichess.org/@/",
        "https://www.chess.com/member/",
    ] {
        if let Some(username) = url.strip_prefix(prefix) {
            if trace_core::valid_query(username) {
                return Ok(url.into());
            }
        }
    }
    Err("Unsupported source URL.".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let (directory, _) =
                data::data_directory(app.path().app_data_dir()?).map_err(std::io::Error::other)?;
            let store =
                data::Store::open(&directory.join("trace.db")).map_err(std::io::Error::other)?;
            app.manage(features::Features::new(store));
            Ok(())
        })
        .manage(SearchState::default())
        .invoke_handler(tauri::generate_handler![
            start_search,
            cancel_search,
            open_source,
            features::get_preferences,
            features::set_preferences,
            features::list_scans,
            features::delete_scan,
            features::clear_history,
            features::delete_all_data,
            features::configure_provider,
            features::provider_status,
            features::password_check,
            features::public_web_search,
            features::breach_check
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Nexonic Trace");
}

#[cfg(test)]
mod tests {
    use super::reqwest_url;

    #[test]
    fn source_opening_accepts_only_generated_profile_links() {
        for url in ["https://github.com/octocat", "https://dev.to/ben"] {
            assert!(reqwest_url(url).is_ok());
        }
        for url in [
            "http://github.com/octocat",
            "https://github.com.evil.test/octocat",
            "https://github.com/../admin",
            "https://dev.to/ben?redirect=https://evil.test",
            "https://127.0.0.1/",
            "file:///etc/passwd",
            "javascript:alert(1)",
        ] {
            assert!(reqwest_url(url).is_err());
        }
    }
}
