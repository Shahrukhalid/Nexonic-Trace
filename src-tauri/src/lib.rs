use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use trace_core::{SearchSummary, SearchUpdate};

#[derive(Default)]
struct SearchState {
    active: Mutex<Option<(String, CancellationToken)>>,
    last_start: Mutex<Option<Instant>>,
}

#[tauri::command]
async fn start_search(
    state: tauri::State<'_, SearchState>,
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
    let result = trace_core::discover(job_id.clone(), &query, timeout_seconds, token, |update| {
        let _ = on_update.send(update);
    })
    .await;
    let mut active = state.active.lock().await;
    if active.as_ref().is_some_and(|(id, _)| id == &job_id) {
        *active = None;
    }
    result
}

#[tauri::command]
async fn cancel_search(state: tauri::State<'_, SearchState>, job_id: String) -> Result<(), String> {
    if let Some((id, token)) = &*state.active.lock().await {
        if id == &job_id {
            token.cancel();
        }
    }
    Ok(())
}

#[tauri::command]
fn open_source(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = reqwest_url(&url)?;
    app.opener()
        .open_url(parsed, None::<&str>)
        .map_err(|_| "Could not open the source in your browser.".into())
}

fn reqwest_url(url: &str) -> Result<String, String> {
    // Only generated profile URLs with a supported username can leave the app.
    for prefix in ["https://github.com/", "https://dev.to/"] {
        if let Some(username) = url.strip_prefix(prefix) {
            if trace_core::valid_query(username) {
                return Ok(url.into());
            }
        }
    }
    Err("Unsupported source URL.".into())
}

#[tauri::command]
async fn save_report(
    app: tauri::AppHandle,
    format: String,
    content: String,
) -> Result<bool, String> {
    if !["json", "csv"].contains(&format.as_str()) || content.len() > 2_097_152 {
        return Err("Unsupported report format or report size.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_title("Save Nexonic Trace report")
            .set_file_name(format!("NexonicTrace-Report.{format}"))
            .add_filter("Report", &[&format])
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = file
            .into_path()
            .map_err(|_| "This destination is not supported by this development build.")?;
        std::fs::write(path, content)
            .map_err(|_| "The report could not be written. Choose a writable destination.")?;
        Ok(true)
    })
    .await
    .map_err(|_| "The save dialog could not finish.")?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SearchState::default())
        .invoke_handler(tauri::generate_handler![
            start_search,
            cancel_search,
            open_source,
            save_report
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
