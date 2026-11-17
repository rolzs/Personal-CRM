//! Apple Calendar (EventKit) bridge for two-way reminder sync.
//!
//! EventKit objects are not thread-safe, so one dedicated thread owns the
//! `EKEventStore` and every command runs as a job on that thread. The sync
//! rules themselves live in the frontend (`src/lib/calendar/reconcile.ts`);
//! this module only lists, writes and deletes events in the "CRM" calendar
//! and reports external changes as a `calendar-changed` event.

use block2::RcBlock;
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::Bool;
use objc2_event_kit::{
    EKAuthorizationStatus, EKCalendar, EKEntityType, EKEvent, EKEventStore,
    EKEventStoreChangedNotification, EKSourceType, EKSpan,
};
use objc2_foundation::{NSArray, NSDate, NSError, NSNotification, NSNotificationCenter, NSString, NSURL};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::ptr::NonNull;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const CALENDAR_TITLE: &str = "CRM";
const URL_PREFIX: &str = "personalcrm://reminder/";

struct Ctx {
    store: RefCell<Retained<EKEventStore>>,
}
type Job = Box<dyn FnOnce(&Ctx) + Send>;

static WORKER: OnceLock<Mutex<mpsc::Sender<Job>>> = OnceLock::new();

/// Start the EventKit thread and the change observer. Called once from `setup`.
pub fn start(app: AppHandle) {
    let (tx, rx) = mpsc::channel::<Job>();
    if WORKER.set(Mutex::new(tx)).is_err() {
        return;
    }
    std::thread::Builder::new()
        .name("eventkit".into())
        .spawn(move || {
            let ctx = Ctx { store: RefCell::new(unsafe { EKEventStore::new() }) };
            observe_changes(app);
            for job in rx {
                autoreleasepool(|_| job(&ctx));
            }
        })
        .expect("failed to start EventKit thread");
}

/// External edits (Calendar.app, iPhone via iCloud) and our own writes both
/// post EKEventStoreChangedNotification; the frontend debounces and reconciles.
fn observe_changes(app: AppHandle) {
    let block = RcBlock::new(move |_n: NonNull<NSNotification>| {
        let _ = app.emit_to("main", "calendar-changed", ());
    });
    let token = unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(EKEventStoreChangedNotification),
            None,
            None,
            &block,
        )
    };
    // The observer lives for the whole process.
    std::mem::forget(token);
}

/// Run `f` on the EventKit thread and wait for its result without blocking Tauri's main thread.
async fn run<T: Send + 'static>(
    f: impl FnOnce(&Ctx) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = mpsc::channel();
    let job: Job = Box::new(move |ctx| {
        let _ = tx.send(f(ctx));
    });
    WORKER
        .get()
        .ok_or("eventkit_not_started")?
        .lock()
        .unwrap()
        .send(job)
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|e| e.to_string())?)
        .await
        .map_err(|e| e.to_string())?
}

fn err(e: Retained<NSError>) -> String {
    e.localizedDescription().to_string()
}
fn ns(s: &str) -> Retained<NSString> {
    NSString::from_str(s)
}
fn date(ms: f64) -> Retained<NSDate> {
    NSDate::dateWithTimeIntervalSince1970(ms / 1000.0)
}
fn ms(d: &NSDate) -> f64 {
    (d.timeIntervalSince1970() * 1000.0).round()
}

fn status_str() -> &'static str {
    let s = unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };
    match s.0 {
        x if x == EKAuthorizationStatus::FullAccess.0 => "full",
        x if x == EKAuthorizationStatus::WriteOnly.0 => "write_only",
        x if x == EKAuthorizationStatus::Denied.0 || x == EKAuthorizationStatus::Restricted.0 => "denied",
        _ => "not_determined",
    }
}

fn find_calendar(store: &EKEventStore, id: &str) -> Result<Retained<EKCalendar>, String> {
    if id.is_empty() {
        return Err("calendar_missing".into());
    }
    unsafe { store.calendarWithIdentifier(&ns(id)) }.ok_or_else(|| "calendar_missing".into())
}

// ───────────────────────── commands ─────────────────────────

/// "not_determined" | "denied" | "full" | "write_only"
#[tauri::command]
pub fn calendar_status() -> &'static str {
    status_str()
}

/// Shows the macOS permission prompt (only the first time). Returns true when full access is granted.
#[tauri::command]
pub async fn calendar_request_access() -> Result<bool, String> {
    run(|ctx| {
        let (tx, rx) = mpsc::channel::<bool>();
        let block = RcBlock::new(move |granted: Bool, _e: *mut NSError| {
            let _ = tx.send(granted.as_bool());
        });
        unsafe {
            ctx.store
                .borrow()
                .requestFullAccessToEventsWithCompletion(&*block as *const _ as *mut _)
        };
        let granted = rx.recv_timeout(Duration::from_secs(600)).unwrap_or(false);
        if granted {
            // A store created before access was granted does not see any calendars.
            *ctx.store.borrow_mut() = unsafe { EKEventStore::new() };
        }
        Ok(granted)
    })
    .await
}

/// Return the id of the CRM calendar, creating it if needed (iCloud first, then the
/// default calendar's account, then "On My Mac").
#[tauri::command]
pub async fn calendar_ensure(calendar_id: Option<String>) -> Result<String, String> {
    run(move |ctx| {
        let store = ctx.store.borrow();
        if let Some(cal) = calendar_id.as_deref().and_then(|id| find_calendar(&store, id).ok()) {
            return Ok(unsafe { cal.calendarIdentifier() }.to_string());
        }
        // Reuse an existing writable "CRM" calendar (e.g. after a reinstall).
        for cal in unsafe { store.calendarsForEntityType(EKEntityType::Event) }.iter() {
            if unsafe { cal.title() }.to_string() == CALENDAR_TITLE && unsafe { cal.allowsContentModifications() } {
                return Ok(unsafe { cal.calendarIdentifier() }.to_string());
            }
        }
        let sources = unsafe { store.sources() };
        let mut candidates = Vec::new();
        for s in sources.iter() {
            if unsafe { s.sourceType() }.0 == EKSourceType::CalDAV.0 && unsafe { s.title() }.to_string() == "iCloud" {
                candidates.push(s);
            }
        }
        if let Some(src) = unsafe { store.defaultCalendarForNewEvents() }.and_then(|c| unsafe { c.source() }) {
            candidates.push(src);
        }
        for s in sources.iter() {
            if unsafe { s.sourceType() }.0 == EKSourceType::Local.0 {
                candidates.push(s);
            }
        }
        let mut last_error = "no_calendar_source".to_string();
        for src in candidates {
            let cal = unsafe { EKCalendar::calendarForEntityType_eventStore(EKEntityType::Event, &store) };
            unsafe {
                cal.setTitle(&ns(CALENDAR_TITLE));
                cal.setSource(Some(&src));
            }
            match unsafe { store.saveCalendar_commit_error(&cal, true) } {
                Ok(()) => return Ok(unsafe { cal.calendarIdentifier() }.to_string()),
                Err(e) => last_error = err(e),
            }
        }
        Err(last_error)
    })
    .await
}

#[derive(Serialize)]
pub struct CalEvent {
    event_id: Option<String>,
    url: Option<String>,
    title: String,
    start: f64,
    end: f64,
    all_day: bool,
}

/// Events of the CRM calendar between `from` and `to` (epoch ms). Recurring events are skipped:
/// the CRM never creates them and cannot represent them.
#[tauri::command]
pub async fn calendar_list_events(calendar_id: String, from: f64, to: f64) -> Result<Vec<CalEvent>, String> {
    run(move |ctx| {
        let store = ctx.store.borrow();
        let cal = find_calendar(&store, &calendar_id)?;
        let cals = NSArray::from_retained_slice(&[cal]);
        let pred = unsafe {
            store.predicateForEventsWithStartDate_endDate_calendars(&date(from), &date(to), Some(&cals))
        };
        let mut out = Vec::new();
        for e in unsafe { store.eventsMatchingPredicate(&pred) }.iter() {
            if unsafe { e.hasRecurrenceRules() } {
                continue;
            }
            out.push(CalEvent {
                event_id: unsafe { e.eventIdentifier() }.map(|s| s.to_string()),
                url: unsafe { e.URL() }.and_then(|u| u.absoluteString()).map(|s| s.to_string()),
                title: unsafe { e.title() }.to_string(),
                start: ms(&*unsafe { e.startDate() }),
                end: ms(&*unsafe { e.endDate() }),
                all_day: unsafe { e.isAllDay() },
            });
        }
        Ok(out)
    })
    .await
}

#[derive(Deserialize)]
pub struct UpsertItem {
    event_id: Option<String>,
    reminder_id: String,
    title: String,
    notes: String,
    start: f64,
    end: f64,
}

#[derive(Serialize)]
pub struct UpsertResult {
    reminder_id: String,
    event_id: Option<String>,
}

/// Create or update events (matched by `event_id`) and tag each with the reminder's URL.
#[tauri::command]
pub async fn calendar_upsert(calendar_id: String, items: Vec<UpsertItem>) -> Result<Vec<UpsertResult>, String> {
    run(move |ctx| {
        let store = ctx.store.borrow();
        let cal = find_calendar(&store, &calendar_id)?;
        let mut saved = Vec::new();
        for it in items {
            let existing = it
                .event_id
                .as_deref()
                .and_then(|id| unsafe { store.eventWithIdentifier(&ns(id)) })
                .filter(|e| {
                    unsafe { e.calendar() }
                        .map(|c| unsafe { c.calendarIdentifier() }.to_string() == calendar_id)
                        .unwrap_or(false)
                });
            let ev = existing.unwrap_or_else(|| {
                let e = unsafe { EKEvent::eventWithEventStore(&store) };
                unsafe { e.setCalendar(Some(&cal)) };
                e
            });
            let url = NSURL::URLWithString(&ns(&format!("{URL_PREFIX}{}", it.reminder_id)));
            unsafe {
                ev.setTitle(Some(&ns(&it.title)));
                ev.setNotes(Some(&ns(&it.notes)));
                ev.setAllDay(false);
                ev.setStartDate(Some(&date(it.start)));
                ev.setEndDate(Some(&date(it.end.max(it.start + 60_000.0))));
                ev.setURL(url.as_deref());
                store.saveEvent_span_commit_error(&ev, EKSpan::ThisEvent, false).map_err(err)?;
            }
            saved.push((it.reminder_id, ev));
        }
        unsafe { store.commit() }.map_err(err)?;
        Ok(saved
            .into_iter()
            .map(|(reminder_id, ev)| UpsertResult {
                reminder_id,
                event_id: unsafe { ev.eventIdentifier() }.map(|s| s.to_string()),
            })
            .collect())
    })
    .await
}

/// Delete events by id. Ids that no longer exist are ignored.
#[tauri::command]
pub async fn calendar_delete(event_ids: Vec<String>) -> Result<(), String> {
    run(move |ctx| {
        let store = ctx.store.borrow();
        for id in event_ids {
            if let Some(ev) = unsafe { store.eventWithIdentifier(&ns(&id)) } {
                unsafe { store.removeEvent_span_commit_error(&ev, EKSpan::ThisEvent, false) }.map_err(err)?;
            }
        }
        unsafe { store.commit() }.map_err(err)
    })
    .await
}

/// System Settings → Privacy & Security → Calendars (to grant access after a denial).
#[tauri::command]
pub fn calendar_open_privacy_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars")
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
