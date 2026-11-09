use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

const RELEASE_API: &str = "https://api.github.com/repos/Shahrukhalid/Nexonic-Trace/releases";
const RELEASE_PAGE: &str = "https://github.com/Shahrukhalid/Nexonic-Trace/releases/tag";
const CHECK_FAILED: &str = "Could not check for updates. Please try again.";

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    state: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    available_version: Option<String>,
}

fn release_version(tag: &str) -> Option<Version> {
    let version = Version::parse(tag.strip_prefix('v')?).ok()?;
    if !version.build.is_empty() {
        return None;
    }
    if !version.pre.is_empty()
        && version
            .pre
            .as_str()
            .strip_prefix("dev.")
            .is_none_or(|number| number.parse::<u64>().is_err())
    {
        return None;
    }
    Some(version)
}

fn installed_version(app: &AppHandle) -> Version {
    option_env!("NEXONIC_DEVELOPMENT_TAG")
        .and_then(release_version)
        .filter(|version| !version.pre.is_empty())
        .unwrap_or_else(|| app.package_info().version.clone())
}

fn installer_name(development: bool) -> Option<String> {
    let flavor = if development { "-Development" } else { "" };
    let name = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => format!("Windows-x64{flavor}-Setup.exe"),
        ("macos", "aarch64") => format!("macOS-AppleSilicon{flavor}.dmg"),
        ("macos", "x86_64") => format!("macOS-Intel{flavor}.dmg"),
        ("android", "aarch64") => format!("Android-ARM64{flavor}.apk"),
        ("android", "arm") => format!("Android-ARM32{flavor}.apk"),
        _ => return None,
    };
    Some(format!("NexonicTrace-{name}"))
}

fn newest_update(releases: Vec<Release>, installed: &Version, installer: &str) -> Option<Version> {
    let development = !installed.pre.is_empty();
    releases
        .into_iter()
        .filter(|release| !release.draft && release.prerelease == development)
        .filter(|release| {
            release
                .assets
                .iter()
                .any(|asset| asset.name == installer && asset.state == "uploaded")
        })
        .filter_map(|release| release_version(&release.tag_name))
        .filter(|version| version.pre.is_empty() != development && version > installed)
        .max()
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    installed_version(&app).to_string()
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<UpdateCheck, String> {
    let installed = installed_version(&app);
    let development = !installed.pre.is_empty();
    let installer =
        installer_name(development).ok_or("Update checks are unavailable for this platform.")?;
    let endpoint = if development {
        "?per_page=30"
    } else {
        "/latest"
    };
    let mut response = trace_core::http_client(8)
        .map_err(|_| CHECK_FAILED)?
        .get(format!("{RELEASE_API}{endpoint}"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| CHECK_FAILED)?;
    if !development && response.status().as_u16() == 404 {
        return Ok(UpdateCheck {
            available_version: None,
        });
    }
    if !response.status().is_success() {
        return Err(CHECK_FAILED.into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| CHECK_FAILED)? {
        if body.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err(CHECK_FAILED.into());
        }
        body.extend_from_slice(&chunk);
    }
    let releases = if development {
        serde_json::from_slice::<Vec<Release>>(&body).map_err(|_| CHECK_FAILED)?
    } else {
        vec![serde_json::from_slice::<Release>(&body).map_err(|_| CHECK_FAILED)?]
    };
    Ok(UpdateCheck {
        available_version: newest_update(releases, &installed, &installer)
            .map(|version| version.to_string()),
    })
}

#[tauri::command]
pub fn open_update_release(app: AppHandle, version: String) -> Result<(), String> {
    let tag = format!("v{version}");
    if release_version(&tag).is_none() {
        return Err("Invalid release version.".into());
    }
    app.opener()
        .open_url(format!("{RELEASE_PAGE}/{tag}"), None::<&str>)
        .map_err(|_| "Could not open the GitHub release page.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chooses_the_newest_compatible_published_release() {
        let installer = "NexonicTrace-Windows-x64-Development-Setup.exe";
        let release = |tag: &str, draft, prerelease, name: &str, state: &str| Release {
            tag_name: tag.into(),
            draft,
            prerelease,
            assets: vec![Asset {
                name: name.into(),
                state: state.into(),
            }],
        };
        let releases = vec![
            release("v0.1.0-dev.9", false, true, installer, "uploaded"),
            release("v0.1.0-dev.10", false, true, installer, "uploaded"),
            release("v0.1.0-dev.11", true, true, installer, "uploaded"),
            release("v0.1.0-dev.12", false, true, installer, "new"),
            release("v0.1.0-dev.13", false, true, "other.exe", "uploaded"),
            release("v0.2.0", false, true, installer, "uploaded"),
            release("v0.3.0", false, false, installer, "uploaded"),
        ];
        assert_eq!(
            newest_update(releases, &Version::parse("0.1.0-dev.8").unwrap(), installer),
            Some(Version::parse("0.1.0-dev.10").unwrap()),
        );
        assert!(release_version("v0.1.0-dev.7/../malicious").is_none());
        assert!(release_version("v0.1.0-beta.1").is_none());
    }
}
