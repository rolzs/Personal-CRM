//! Shared in-memory state for the Rust side.

use serde::Deserialize;
use std::sync::atomic::AtomicI64;
use std::sync::Mutex;

/// One pending (not done) reminder as pushed from the frontend.
#[derive(Debug, Clone, Deserialize)]
pub struct ReminderItem {
    pub id: String,
    pub title: String,
    /// Second line of the notification (contact name, may be empty).
    #[serde(default)]
    pub body: String,
    /// Effective fire time, epoch ms (snoozed_until if set, else datetime).
    pub at: i64,
}

pub struct AppState {
    pub reminders: Mutex<Vec<ReminderItem>>,
    /// Upper bound of the time window already checked by the scheduler.
    pub last_tick_ms: AtomicI64,
    /// Current UI language ("lv" | "en") for menu, tray and notifications.
    pub lang: Mutex<String>,
    /// When the tray dropdown was last hidden (to ignore the click that hid it).
    pub tray_hidden_at_ms: AtomicI64,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            reminders: Mutex::new(Vec::new()),
            last_tick_ms: AtomicI64::new(now_ms()),
            lang: Mutex::new("lv".into()),
            tray_hidden_at_ms: AtomicI64::new(0),
        }
    }
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
