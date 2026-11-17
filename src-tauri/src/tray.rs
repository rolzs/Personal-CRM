//! Menu bar (tray) icon. Its title shows how many reminders are due today
//! (overdue ones included); a left click toggles the dropdown window.

use crate::{i18n::tr, state::AppState, windows};
use chrono::{Local, TimeZone};
use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

const TRAY_ID: &str = "crm-tray";

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip("Personal CRM")
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                windows::toggle_tray(tray.app_handle(), rect);
            }
        })
        .build(app)?;
    Ok(())
}

/// Recompute the badge count and tooltip from the current reminder list.
pub fn refresh(app: &AppHandle) {
    let state = app.state::<AppState>();
    let today = Local::now().date_naive();
    let count = state
        .reminders
        .lock()
        .unwrap()
        .iter()
        .filter(|r| {
            Local
                .timestamp_millis_opt(r.at)
                .single()
                .map(|d| d.date_naive() <= today)
                .unwrap_or(false)
        })
        .count();
    let lang = state.lang.lock().unwrap().clone();

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let title = if count > 0 { Some(count.to_string()) } else { None };
        let _ = tray.set_title(title);
        let tooltip = format!("Personal CRM – {}: {}", tr(&lang, "tray.today"), count);
        let _ = tray.set_tooltip(Some(tooltip));
    }
}
