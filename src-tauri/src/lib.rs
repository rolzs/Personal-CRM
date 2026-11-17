//! Personal CRM – Rust side.
//!
//! The frontend owns the data (SQLite through `tauri-plugin-sql`). Rust owns
//! everything that has to keep working while the window is hidden:
//!   * `reminders` – scheduler thread that fires native notifications
//!   * `tray`      – menu bar icon with today's count + dropdown window
//!   * `menu`      – native, translated macOS menu bar
//!   * `windows`   – show/hide helpers, global hotkey, Dock icon
//!   * `backup`    – SQLite file backup/restore and plain file I/O for exports
//!   * `i18n`      – reads the same locales/*.json the frontend uses
//!   * `calendar`  – EventKit bridge for two-way Apple Calendar sync
//!   * `ai`        – Apple Intelligence (Foundation Models) via a Swift bridge

mod ai;
mod backup;
mod calendar;
mod i18n;
mod menu;
mod reminders;
mod state;
mod tray;
mod windows;

use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_sql::{Migration, MigrationKind};
use tauri_plugin_window_state::StateFlags;

/// Versioned schema migrations, applied by tauri-plugin-sql on `Database.load`.
/// Add new files as 002_*.sql, 003_*.sql … and append them here.
fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial schema",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "apple calendar links",
            sql: include_str!("../migrations/002_calendar_links.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:crm.db", migrations())
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            // Remember size + position of the main window only.
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["quickadd", "tray"])
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            reminders::sync_reminders,
            menu::set_language,
            windows::set_dock_visible,
            windows::set_hotkey,
            windows::show_main_window,
            windows::hide_current_window,
            backup::db_path,
            backup::default_backup_dir,
            backup::backup_db,
            backup::restore_db,
            backup::write_text_file,
            backup::read_text_file,
            backup::open_ics,
            calendar::calendar_status,
            calendar::calendar_request_access,
            calendar::calendar_ensure,
            calendar::calendar_list_events,
            calendar::calendar_upsert,
            calendar::calendar_delete,
            calendar::calendar_open_privacy_settings,
            ai::ai_call,
        ])
        .on_menu_event(menu::handle_event)
        .on_window_event(|window, event| match event {
            // Cmd+W / red close button: hide instead of quitting so the menu
            // bar process keeps firing reminders. Cmd+Q really quits.
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            // The two popover-style windows close when they lose focus.
            WindowEvent::Focused(false) => match window.label() {
                "tray" => windows::hide_tray(window.app_handle()),
                "quickadd" => windows::hide_quickadd(window.app_handle()),
                _ => {}
            },
            _ => {}
        })
        .setup(|app| {
            let handle = app.handle().clone();

            // Notifications are attributed to this bundle id (Terminal in dev,
            // because an unbundled binary has no id of its own).
            let bundle_id = if tauri::is_dev() {
                "com.apple.Terminal".to_string()
            } else {
                app.config().identifier.clone()
            };
            let _ = mac_notification_sys::set_application(&bundle_id);

            menu::install(&handle, "lv")?;
            tray::install(&handle)?;
            reminders::start_scheduler(handle.clone());
            calendar::start(handle.clone());

            // Launched at login → stay in the menu bar only.
            if !std::env::args().any(|a| a == "--hidden") {
                windows::show_main(&handle);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Personal CRM");

    app.run(|app, event| {
        // Clicking the Dock icon while the window is hidden brings it back.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            windows::show_main(app);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}
