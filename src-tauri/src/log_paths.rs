use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub const HMI_LOG_DIR_ENV: &str = "HMI_LOG_DIR";

pub fn resolve_log_dir(app: Option<&AppHandle>) -> Result<PathBuf, String> {
    if let Some(configured) = configured_log_dir() {
        return Ok(configured);
    }

    if cfg!(debug_assertions) {
        return Ok(workspace_tmp_log_dir());
    }

    if let Some(app) = app {
        let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
        return Ok(resource_dir
            .parent()
            .map(|path| path.join("Log"))
            .unwrap_or_else(|| resource_dir.join("Log")));
    }

    let exe = std::env::current_exe()
        .map_err(|error| format!("failed to resolve executable path: {error}"))?;
    Ok(exe
        .parent()
        .map(|path| path.join("Log"))
        .unwrap_or_else(|| PathBuf::from("Log")))
}

pub fn default_log_dir() -> PathBuf {
    resolve_log_dir(None).unwrap_or_else(|_| workspace_tmp_log_dir())
}

pub fn ensure_log_dir(log_dir: PathBuf) -> Result<PathBuf, String> {
    std::fs::create_dir_all(&log_dir)
        .map_err(|e| format!("Failed to create Log directory: {}", e))?;
    Ok(log_dir)
}

fn configured_log_dir() -> Option<PathBuf> {
    std::env::var_os(HMI_LOG_DIR_ENV).and_then(|value| {
        let value = value.to_string_lossy().trim().to_string();
        if value.is_empty() {
            None
        } else {
            Some(PathBuf::from(value))
        }
    })
}

fn workspace_tmp_log_dir() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(|path| path.join("tmp").join("Log"))
        .unwrap_or_else(|| manifest_dir.join("tmp").join("Log"))
}
