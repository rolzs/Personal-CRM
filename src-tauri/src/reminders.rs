//! Reminder scheduler.
//!
//! The frontend pushes the list of pending reminders with `sync_reminders`
//! every time something changes. A background thread wakes up every few
//! seconds and fires a native notification for everything that became due
//! since the previous tick – this keeps working while the window is hidden
//! and catches up after the Mac wakes from sleep.
//!
//! Notification buttons (Snooze +15 min / +1 h / Mark done) and clicks are
//! reported back to the frontend as `reminder-action` events, which then
//! updates the database.

use crate::{i18n::tr, state::{now_ms, AppState, ReminderItem}, tray, windows};
use mac_notification_sys::{MainButton, Notification, NotificationResponse};
use serde::Serialize;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

const TICK: Duration = Duration::from_secs(5);

#[derive(Clone, Serialize)]
struct ActionPayload {
    id: String,
    /// "click" | "snooze15" | "snooze60" | "done"
    action: &'static str,
}

#[tauri::command]
pub fn sync_reminders(app: AppHandle, items: Vec<ReminderItem>) {
    *app.state::<AppState>().reminders.lock().unwrap() = items;
    tray::refresh(&app);
}

pub fn start_scheduler(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(TICK);
        tick(&app);
    });
}

fn tick(app: &AppHandle) {
    let state = app.state::<AppState>();
    let now = now_ms();
    let since = state.last_tick_ms.swap(now, Ordering::Relaxed);

    let due: Vec<ReminderItem> = state
        .reminders
        .lock()
        .unwrap()
        .iter()
        .filter(|r| r.at > since && r.at <= now)
        .cloned()
        .collect();
    let lang = state.lang.lock().unwrap().clone();

    for item in due {
        notify(app.clone(), item, lang.clone());
    }

    // Keeps the badge right across midnight and lets the frontend run its
    // periodic jobs (auto backup, "last seen" stamp) without JS timers,
    // which WebKit throttles in hidden windows.
    tray::refresh(app);
    let _ = app.emit_to("main", "tick", now);
}

/// Show one notification and wait (on its own thread) for the user's response.
fn notify(app: AppHandle, item: ReminderItem, lang: String) {
    std::thread::spawn(move || {
        let snooze15 = tr(&lang, "notification.snooze15");
        let snooze60 = tr(&lang, "notification.snooze60");
        let done = tr(&lang, "notification.done");
        let actions_label = tr(&lang, "notification.actions");
        let close_label = tr(&lang, "notification.close");
        let actions = [snooze15.as_str(), snooze60.as_str(), done.as_str()];

        let mut n = Notification::new();
        n.title(&item.title)
            .main_button(MainButton::DropdownActions(&actions_label, &actions))
            .close_button(&close_label)
            .wait_for_click(true);
        if !item.body.is_empty() {
            n.message(&item.body);
        }

        let action = match n.send() {
            Ok(NotificationResponse::Click) => Some("click"),
            Ok(NotificationResponse::ActionButton(label)) => {
                if label == snooze15 {
                    Some("snooze15")
                } else if label == snooze60 {
                    Some("snooze60")
                } else if label == done {
                    Some("done")
                } else {
                    Some("click")
                }
            }
            Ok(_) => None,
            Err(_) => {
                // Fallback: plain notification through the Tauri plugin.
                let _ = app
                    .notification()
                    .builder()
                    .title(&item.title)
                    .body(&item.body)
                    .show();
                None
            }
        };

        if let Some(action) = action {
            if action == "click" {
                windows::show_main(&app);
            }
            let _ = app.emit_to("main", "reminder-action", ActionPayload { id: item.id, action });
        }
    });
}
