//! Database file backup / restore and small file helpers for JSON + .ics export.
//! All paths come from native open/save dialogs or from the user's settings.

use chrono::Local;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const KEEP_AUTO_BACKUPS: usize = 14;
const AUTO_PREFIX: &str = "crm-auto-";
const MANUAL_PREFIX: &str = "crm-backup-";

/// Same location tauri-plugin-sql resolves "sqlite:crm.db" to:
/// ~/Library/Application Support/<identifier>/crm.db
fn db_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|d| d.join("crm.db"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_path(app: AppHandle) -> Result<String, String> {
    db_file(&app).map(|p| p.to_string_lossy().into_owned())
}

/// ~/Documents/CRM Backups
#[tauri::command]
pub fn default_backup_dir(app: AppHandle) -> Result<String, String> {
    app.path()
        .document_dir()
        .map(|d| d.join("CRM Backups").to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

/// Copy the SQLite file into `folder`. Automatic (daily) backups are pruned
/// to the newest 14; manual backups are never deleted.
/// The frontend checkpoints the WAL first so the single file is complete.
#[tauri::command]
pub fn backup_db(app: AppHandle, folder: String, auto: bool) -> Result<String, String> {
    let dir = PathBuf::from(folder);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let prefix = if auto { AUTO_PREFIX } else { MANUAL_PREFIX };
    let stamp = Local::now().format("%Y-%m-%d_%H%M%S");
    let dest = dir.join(format!("{prefix}{stamp}.sqlite"));
    fs::copy(db_file(&app)?, &dest).map_err(|e| e.to_string())?;

    if auto {
        let mut autos: Vec<PathBuf> = fs::read_dir(&dir)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with(AUTO_PREFIX) && n.ends_with(".sqlite"))
                    .unwrap_or(false)
            })
            .collect();
        autos.sort(); // timestamped names sort chronologically
        while autos.len() > KEEP_AUTO_BACKUPS {
            let _ = fs::remove_file(autos.remove(0));
        }
    }
    Ok(dest.to_string_lossy().into_owned())
}

/// Replace the live database with a backup file. The frontend closes its
/// connection before calling this and reloads afterwards.
#[tauri::command]
pub fn restore_db(app: AppHandle, path: String) -> Result<(), String> {
    let src = PathBuf::from(path);
    let bytes = fs::read(&src).map_err(|e| e.to_string())?;
    if !bytes.starts_with(b"SQLite format 3\0") {
        return Err("not_sqlite".into());
    }
    let db = db_file(&app)?;
    fs::write(&db, bytes).map_err(|e| e.to_string())?;
    // Stale journal files would be replayed over the restored database.
    for suffix in ["-wal", "-shm"] {
        let mut name = db.clone().into_os_string();
        name.push(suffix);
        let _ = fs::remove_file(PathBuf::from(name));
    }
    Ok(())
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// "Export to calendar" for a single reminder: write a temporary .ics and
/// open it, which makes Apple Calendar offer to add the event.
#[tauri::command]
pub fn open_ics(app: AppHandle, name: String, contents: String) -> Result<(), String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("ics");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '_' })
        .collect();
    let file = dir.join(format!("{safe}.ics"));
    fs::write(&file, contents).map_err(|e| e.to_string())?;
    std::process::Command::new("open")
        .arg(&file)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
