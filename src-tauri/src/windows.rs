//! Window helpers: main window, floating quick-add, tray dropdown,
//! global hotkey and Dock icon visibility.

use crate::state::{now_ms, AppState};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Rect};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn main_visible(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

/// Global hotkey target: small always-on-top window, usable from any app.
pub fn toggle_quickadd(app: &AppHandle) {
    let Some(w) = app.get_webview_window("quickadd") else { return };
    if w.is_visible().unwrap_or(false) {
        hide_quickadd(app);
    } else {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit_to("quickadd", "window-shown", ());
    }
}

pub fn hide_quickadd(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("quickadd") {
        if !w.is_visible().unwrap_or(false) {
            return;
        }
        let _ = w.hide();
        // Hand focus back to the app the user was in.
        #[cfg(target_os = "macos")]
        if !main_visible(app) {
            let _ = app.hide();
        }
    }
}

/// Show the dropdown centred under the tray icon, or hide it.
pub fn toggle_tray(app: &AppHandle, icon: Rect) {
    let Some(w) = app.get_webview_window("tray") else { return };
    let state = app.state::<AppState>();
    // The click that should close the dropdown first blurs (= hides) it;
    // don't immediately reopen it.
    let just_hidden = now_ms() - state.tray_hidden_at_ms.load(Ordering::Relaxed) < 400;
    if w.is_visible().unwrap_or(false) || just_hidden {
        hide_tray(app);
        return;
    }
    let scale = w.scale_factor().unwrap_or(1.0);
    let pos: PhysicalPosition<f64> = icon.position.to_physical(scale);
    let size: PhysicalSize<f64> = icon.size.to_physical(scale);
    let width = w.outer_size().map(|s| s.width as f64).unwrap_or(360.0 * scale);
    let x = (pos.x + size.width / 2.0 - width / 2.0).max(8.0);
    let y = pos.y + size.height + 4.0;
    let _ = w.set_position(PhysicalPosition::new(x, y));
    let _ = w.show();
    let _ = w.set_focus();
    let _ = app.emit_to("tray", "window-shown", ());
}

pub fn hide_tray(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("tray") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            app.state::<AppState>()
                .tray_hidden_at_ms
                .store(now_ms(), Ordering::Relaxed);
        }
    }
}

// ───────────────────────── commands ─────────────────────────

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    hide_tray(&app);
    show_main(&app);
}

/// Esc in the quick-add / tray windows.
#[tauri::command]
pub fn hide_current_window(app: AppHandle, window: tauri::WebviewWindow) {
    match window.label() {
        "quickadd" => hide_quickadd(&app),
        "tray" => hide_tray(&app),
        _ => {
            let _ = window.hide();
        }
    }
}

/// Setting: show/hide the Dock icon (menu bar icon always stays).
#[tauri::command]
pub fn set_dock_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let policy = if visible {
            tauri::ActivationPolicy::Regular
        } else {
            tauri::ActivationPolicy::Accessory
        };
        app.set_activation_policy(policy).map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, visible);
    Ok(())
}

/// (Re)register the system-wide quick-add hotkey, e.g. "Ctrl+Alt+Space".
/// An empty string disables it. Errors (unparsable / taken) go back to the UI.
#[tauri::command]
pub fn set_hotkey(app: AppHandle, shortcut: String) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    let shortcut = shortcut.trim();
    if shortcut.is_empty() {
        return Ok(());
    }
    gs.on_shortcut(shortcut, |app, _shortcut, event| {
        if event.state() == ShortcutState::Pressed {
            toggle_quickadd(app);
        }
    })
    .map_err(|e| e.to_string())
}
