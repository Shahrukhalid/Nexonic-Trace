use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use trace_core::SearchSummary;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub history_enabled: bool,
    pub appearance: String,
    pub timeout_seconds: u64,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            history_enabled: false,
            appearance: "dark".into(),
            timeout_seconds: 12,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedScan {
    pub id: String,
    pub query: String,
    pub mode: String,
    pub created_at: String,
    pub summary: SearchSummary,
}
pub struct Store {
    db: Connection,
}
impl Store {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| "Cannot create local data directory.")?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
                    .map_err(|_| "Cannot protect local data directory.")?;
            }
        }
        let db = Connection::open(path)
            .map_err(|_| "Cannot open local database. Choose a writable application location.")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
                .map_err(|_| "Cannot protect local database.")?;
        }
        Self::initialize(db)
    }
    fn initialize(db: Connection) -> Result<Self, String> {
        db.execute_batch("PRAGMA secure_delete=ON; PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS settings(name TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS scans(id TEXT PRIMARY KEY,query TEXT NOT NULL,mode TEXT NOT NULL,created_at TEXT NOT NULL,summary TEXT NOT NULL);").map_err(|_|"Cannot initialize local database.")?;
        Ok(Self { db })
    }
    pub fn preferences(&self) -> Result<Preferences, String> {
        let value: Option<String> = self
            .db
            .query_row(
                "SELECT value FROM settings WHERE name='preferences'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "Cannot read preferences.")?;
        value
            .map(|value| {
                serde_json::from_str(&value).map_err(|_| "Stored preferences are invalid.".into())
            })
            .unwrap_or(Ok(Preferences::default()))
    }
    pub fn set_preferences(&self, prefs: Preferences) -> Result<(), String> {
        if !["dark", "light"].contains(&prefs.appearance.as_str())
            || !(5..=30).contains(&prefs.timeout_seconds)
        {
            return Err("Invalid preferences.".into());
        }
        let value = serde_json::to_string(&prefs).map_err(|_| "Cannot serialize preferences.")?;
        self.db.execute("INSERT INTO settings(name,value) VALUES('preferences',?1) ON CONFLICT(name) DO UPDATE SET value=excluded.value",[value]).map_err(|_|"Cannot save preferences.")?;
        Ok(())
    }
    pub fn record(&self, query: &str, mode: &str, summary: &SearchSummary) -> Result<(), String> {
        if !self.preferences()?.history_enabled {
            return Ok(());
        }
        let value = serde_json::to_string(summary).map_err(|_| "Cannot serialize scan.")?;
        self.db
            .execute(
                "INSERT INTO scans(id,query,mode,created_at,summary) VALUES(?1,?2,?3,?4,?5)",
                params![
                    summary.job_id,
                    query,
                    mode,
                    chrono::Utc::now().to_rfc3339(),
                    value
                ],
            )
            .map_err(|_| "Cannot save local scan.")?;
        self.db.execute("DELETE FROM scans WHERE id NOT IN (SELECT id FROM scans ORDER BY created_at DESC LIMIT 100)",[]).map_err(|_|"Cannot enforce history retention.")?;
        Ok(())
    }
    pub fn scans(&self) -> Result<Vec<SavedScan>, String> {
        self.scans_with_limit(100)
    }
    pub fn recent_scans(&self) -> Result<Vec<SavedScan>, String> {
        self.scans_with_limit(5)
    }
    fn scans_with_limit(&self, limit: i64) -> Result<Vec<SavedScan>, String> {
        let mut statement=self.db.prepare("SELECT id,query,mode,created_at,summary FROM scans ORDER BY created_at DESC LIMIT ?1").map_err(|_|"Cannot read history.")?;
        let rows = statement
            .query_map([limit], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|_| "Cannot query history.")?;
        rows.map(|row| {
            let (id, query, mode, created_at, body) = row.map_err(|_| "Cannot read scan.")?;
            let summary = serde_json::from_str(&body).map_err(|_| "Stored scan is invalid.")?;
            Ok(SavedScan {
                id,
                query,
                mode,
                created_at,
                summary,
            })
        })
        .collect()
    }
    pub fn delete_scan(&self, id: &str) -> Result<(), String> {
        self.db
            .execute("DELETE FROM scans WHERE id=?1", [id])
            .map_err(|_| "Cannot delete scan.")?;
        self.compact()
    }
    pub fn clear(&self, preferences: bool) -> Result<(), String> {
        self.db
            .execute("DELETE FROM scans", [])
            .map_err(|_| "Cannot clear history.")?;
        if preferences {
            self.db
                .execute("DELETE FROM settings", [])
                .map_err(|_| "Cannot clear preferences.")?;
        }
        self.compact()
    }
    fn compact(&self) -> Result<(), String> {
        self.db
            .execute_batch("VACUUM")
            .map_err(|_| "Cannot compact local database.".into())
    }
}
pub fn data_directory(normal: PathBuf) -> Result<(PathBuf, bool), String> {
    #[cfg(target_os = "windows")]
    {
        let executable =
            std::env::current_exe().map_err(|_| "Cannot locate portable application.")?;
        if let Some(parent) = executable.parent() {
            if parent.join("portable.txt").is_file() {
                return Ok((parent.join("NexonicTraceData"), true));
            }
        }
    }
    Ok((normal, false))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn history_is_opt_in_and_deletable() {
        let store = Store::initialize(Connection::open_in_memory().unwrap()).unwrap();
        let summary = SearchSummary {
            job_id: "test".into(),
            findings: vec![],
            canceled: false,
            warnings: vec![],
            total: 0,
        };
        store.record("sample", "quick", &summary).unwrap();
        assert!(store.scans().unwrap().is_empty());
        store
            .set_preferences(Preferences {
                history_enabled: true,
                ..Preferences::default()
            })
            .unwrap();
        store.record("sample", "quick", &summary).unwrap();
        assert_eq!(store.scans().unwrap().len(), 1);
        store.delete_scan("test").unwrap();
        assert!(store.scans().unwrap().is_empty());
        store.clear(true).unwrap();
        assert!(!store.preferences().unwrap().history_enabled);
    }
    #[test]
    fn parameterized_queries_preserve_literal_queries() {
        let store = Store::initialize(Connection::open_in_memory().unwrap()).unwrap();
        store
            .set_preferences(Preferences {
                history_enabled: true,
                ..Preferences::default()
            })
            .unwrap();
        let summary = SearchSummary {
            job_id: "test".into(),
            findings: vec![],
            canceled: false,
            warnings: vec![],
            total: 0,
        };
        store
            .record("'; DROP TABLE scans;--", "quick", &summary)
            .unwrap();
        assert_eq!(store.scans().unwrap()[0].query, "'; DROP TABLE scans;--");
    }
}
