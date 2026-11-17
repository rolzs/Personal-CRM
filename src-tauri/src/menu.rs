//! Native macOS menu bar (App / File / Edit / View / Window / Help).
//!
//! Custom items forward their id to the frontend as a `menu` event; the
//! standard Cut/Copy/Paste/Select All items make text fields behave natively.

use crate::{i18n::tr, state::AppState, tray, windows};
use tauri::menu::{MenuBuilder, MenuEvent, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager};

/// Build (or rebuild, after a language switch) the whole menu.
pub fn install(app: &AppHandle, lang: &str) -> tauri::Result<()> {
    let t = |key: &str| tr(lang, &format!("menu.{key}"));
    let item = |id: &str, accel: Option<&str>| {
        let mut b = MenuItemBuilder::with_id(id, t(id));
        if let Some(a) = accel {
            b = b.accelerator(a);
        }
        b.build(app)
    };

    let app_menu = SubmenuBuilder::new(app, "Personal CRM")
        .item(&PredefinedMenuItem::about(app, Some(t("about").as_str()), None)?)
        .separator()
        .item(&item("settings", Some("CmdOrCtrl+,"))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some(t("hide").as_str()))?)
        .item(&PredefinedMenuItem::hide_others(app, Some(t("hide_others").as_str()))?)
        .item(&PredefinedMenuItem::show_all(app, Some(t("show_all").as_str()))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some(t("quit").as_str()))?)
        .build()?;

    let file = SubmenuBuilder::new(app, t("file"))
        .item(&item("new_contact", Some("CmdOrCtrl+N"))?)
        .item(&item("quick_add", Some("CmdOrCtrl+K"))?)
        .separator()
        .item(&item("backup_now", None)?)
        .item(&item("export_json", None)?)
        .item(&item("export_ics", None)?)
        .separator()
        .item(&item("close_window", Some("CmdOrCtrl+W"))?)
        .build()?;

    // Undo/Redo are custom so Cmd+Z can undo the last CRM action; the
    // frontend falls back to normal text undo while a text field has focus.
    let edit = SubmenuBuilder::new(app, t("edit"))
        .item(&item("undo", Some("CmdOrCtrl+Z"))?)
        .item(&item("redo", Some("CmdOrCtrl+Shift+Z"))?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some(t("cut").as_str()))?)
        .item(&PredefinedMenuItem::copy(app, Some(t("copy").as_str()))?)
        .item(&PredefinedMenuItem::paste(app, Some(t("paste").as_str()))?)
        .item(&PredefinedMenuItem::select_all(app, Some(t("select_all").as_str()))?)
        .separator()
        .item(&item("search", Some("CmdOrCtrl+F"))?)
        .build()?;

    let view = SubmenuBuilder::new(app, t("view"))
        .item(&item("view_summary", Some("CmdOrCtrl+1"))?)
        .item(&item("view_contacts", Some("CmdOrCtrl+2"))?)
        .item(&item("view_calendar", Some("CmdOrCtrl+3"))?)
        .item(&item("view_activities", Some("CmdOrCtrl+4"))?)
        .build()?;

    let window = SubmenuBuilder::new(app, t("window"))
        .item(&PredefinedMenuItem::minimize(app, Some(t("minimize").as_str()))?)
        .item(&PredefinedMenuItem::maximize(app, Some(t("zoom").as_str()))?)
        .separator()
        .item(&item("show_main", Some("CmdOrCtrl+0"))?)
        .build()?;

    let help = SubmenuBuilder::new(app, t("help"))
        .item(&item("shortcuts", None)?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &view, &window, &help])
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

/// Route menu clicks. Window-level actions are handled here; everything else
/// is forwarded to the main webview.
pub fn handle_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    match id {
        "close_window" => {
            // Hide whichever of our windows currently has focus.
            for (_, w) in app.webview_windows() {
                if w.is_focused().unwrap_or(false) {
                    let _ = w.hide();
                }
            }
        }
        "show_main" => windows::show_main(app),
        // Undo/redo go to whichever window is being typed in, and must not
        // steal focus or pop the main window.
        "undo" | "redo" => {
            let target = app
                .webview_windows()
                .into_iter()
                .find(|(_, w)| w.is_focused().unwrap_or(false))
                .map(|(label, _)| label)
                .unwrap_or_else(|| "main".to_string());
            let _ = app.emit_to(target.as_str(), "menu", id);
        }
        _ => {
            windows::show_main(app);
            let _ = app.emit_to("main", "menu", id);
        }
    }
}

/// Called by the frontend on startup and whenever the language changes.
#[tauri::command]
pub fn set_language(app: AppHandle, lang: String) -> Result<(), String> {
    let lang = if lang == "en" { "en" } else { "lv" };
    *app.state::<AppState>().lang.lock().unwrap() = lang.to_string();
    install(&app, lang).map_err(|e| e.to_string())?;
    tray::refresh(&app);
    Ok(())
}
