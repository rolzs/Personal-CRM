// Runs the two-way Apple Calendar sync: reads the "CRM" calendar and the link
// table, asks reconcile() what to do, then applies it on both sides.
// Only the main window syncs. Runs are debounced and never overlap.

import { contactById, createReminder, data, deleteReminder, execute, select, setSetting, tx, updateReminder } from "../db/store.svelte";
import type { Reminder } from "../db/types";
import { t } from "../i18n/index.svelte";
import { invoke, isTauri } from "../native";
import { toast } from "../ui/state.svelte";
import { desiredEvent, reconcile, type CalEvent, type EventWrite, type Link, type SyncReminder } from "./reconcile";

const DAY = 86_400_000;

export const appleCal = $state({
  /** "not_determined" | "denied" | "full" | "write_only" | "" (unknown / browser) */
  status: "",
  /** Number of reminders that currently have an event in the CRM calendar. */
  count: 0,
  lastSync: 0,
  busy: false,
});

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let again = false;

/** Event notes: who the reminder is about. */
function notesFor(r: Reminder): string {
  const c = contactById(r.contact_id);
  return [c?.name, c?.company, "Personal CRM"].filter(Boolean).join("\n");
}

const toSync = (r: Reminder): SyncReminder => ({
  id: r.id, title: r.title, datetime: r.datetime, duration: r.duration, done: r.done, notes: notesFor(r),
});

function saveLink(l: Link): void {
  execute(
    `INSERT OR REPLACE INTO calendar_links (reminder_id, event_id, synced_title, synced_start, synced_end, synced_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [l.reminder_id, l.event_id, l.synced_title, l.synced_start, l.synced_end, Date.now()],
  );
}

export async function refreshCalendarStatus(): Promise<string> {
  appleCal.status = (await invoke<string>("calendar_status")) ?? "";
  return appleCal.status;
}

/** Ask for a sync soon (coalesces bursts of changes, including our own echoes). */
export function scheduleCalendarSync(delay = 500): void {
  if (!isTauri || !data.settings.calendar_sync) return;
  clearTimeout(timer);
  timer = setTimeout(runSync, delay);
}

async function runSync(): Promise<void> {
  if (running) { again = true; return; }
  running = true;
  appleCal.busy = true;
  try {
    await syncOnce();
  } catch (err) {
    await handleError(String(err));
  } finally {
    running = false;
    appleCal.busy = false;
    if (again) { again = false; scheduleCalendarSync(); }
  }
}

/** Set when a lost permission was re-requested, so a refusal doesn't loop. */
let reRequested = false;

async function handleError(message: string): Promise<void> {
  let status = await refreshCalendarStatus();
  if (status === "not_determined" && !reRequested) {
    // A rebuilt (re-signed) app counts as new to macOS: ask again instead of giving up.
    reRequested = true;
    await invoke<boolean>("calendar_request_access");
    status = await refreshCalendarStatus();
    if (status === "full") { scheduleCalendarSync(0); return; }
  }
  if (status !== "full") {
    setSetting("calendar_sync", false);
    toast(t("apple.lost_access"), { error: true });
  } else if (message.includes("calendar_missing")) {
    // The user deleted the CRM calendar in Calendar.app.
    setSetting("calendar_sync", false);
    setSetting("calendar_id", "");
    execute("DELETE FROM calendar_links");
    toast(t("apple.calendar_missing"), { error: true });
  } else {
    console.error("calendar sync failed", message);
    toast(t("apple.sync_failed", { error: message }), { error: true });
  }
}

async function syncOnce(): Promise<void> {
  const calendarId = data.settings.calendar_id;
  const now = Date.now();
  // EventKit searches at most 4 years at a time.
  const window = { from: now - 365 * DAY, to: now + 3 * 365 * DAY };
  const [events, links] = await Promise.all([
    invoke<CalEvent[]>("calendar_list_events", { calendarId, from: window.from, to: window.to }),
    select<Link>("SELECT reminder_id, event_id, synced_title, synced_start, synced_end FROM calendar_links"),
  ]);

  const plan = reconcile(data.reminders.map(toSync), events ?? [], links, window, data.settings.tomorrow_time);

  // 1. Changes made in Apple Calendar → CRM (one undoable action with a toast).
  const created: { reminder: Reminder; eventId: string | null }[] = [];
  if (plan.crmUpdates.length || plan.crmDeletes.length || plan.crmCreates.length) {
    tx("calendar_synced", () => {
      for (const { id, ...patch } of plan.crmUpdates) updateReminder(id, patch);
      for (const id of plan.crmDeletes) deleteReminder(id);
      for (const c of plan.crmCreates) {
        created.push({ reminder: createReminder({ title: c.title, datetime: c.datetime, duration: c.duration }), eventId: c.event_id });
      }
    }, true);
  }

  // 2. CRM → Apple Calendar. Events added by hand are tagged with their new reminder's URL.
  const writes: EventWrite[] = [
    ...plan.writes,
    ...created.map(({ reminder, eventId }) => {
      const d = desiredEvent(toSync(reminder));
      return { event_id: eventId, reminder_id: reminder.id, title: d.title, notes: notesFor(reminder), start: d.start, end: d.end };
    }),
  ];
  const linkCount = new Set(plan.keepLinks.map((l) => l.reminder_id));
  if (writes.length) {
    const results = (await invoke<{ reminder_id: string; event_id: string | null }[]>("calendar_upsert", { calendarId, items: writes })) ?? [];
    const eventIds = new Map(results.map((r) => [r.reminder_id, r.event_id]));
    for (const w of writes) {
      saveLink({ reminder_id: w.reminder_id, event_id: eventIds.get(w.reminder_id) ?? w.event_id, synced_title: w.title, synced_start: w.start, synced_end: w.end });
      linkCount.add(w.reminder_id);
    }
  }
  if (plan.deleteEvents.length) await invoke("calendar_delete", { eventIds: plan.deleteEvents });

  // 3. Link bookkeeping.
  for (const id of plan.dropLinks) execute("DELETE FROM calendar_links WHERE reminder_id = ?", [id]);
  const original = new Map(links.map((l) => [l.reminder_id, l]));
  for (const l of plan.keepLinks) {
    const o = original.get(l.reminder_id);
    const same = o && o.event_id === l.event_id && o.synced_title === l.synced_title && o.synced_start === l.synced_start && o.synced_end === l.synced_end;
    if (!same) saveLink(l);
  }

  appleCal.count = linkCount.size;
  appleCal.lastSync = Date.now();
}

/** Settings toggle → on. Returns false when access was not granted. */
export async function enableAppleCalendar(): Promise<boolean> {
  if (!isTauri) { toast(t("toast.native_only")); return false; }
  let status = await refreshCalendarStatus();
  if (status === "not_determined") {
    const granted = await invoke<boolean>("calendar_request_access");
    status = await refreshCalendarStatus();
    if (granted && status !== "full") status = "full";
  }
  if (status !== "full") {
    toast(t(status === "write_only" ? "apple.write_only" : "apple.denied"), { error: true });
    return false;
  }
  try {
    const id = await invoke<string>("calendar_ensure", { calendarId: data.settings.calendar_id || null });
    if (id !== data.settings.calendar_id) execute("DELETE FROM calendar_links");
    setSetting("calendar_id", id ?? "");
    setSetting("calendar_sync", true);
    scheduleCalendarSync(0);
    toast(t("apple.enabled"));
    return true;
  } catch (err) {
    toast(t("apple.sync_failed", { error: String(err) }), { error: true });
    return false;
  }
}

/** Settings toggle → off. Events already in the calendar stay there. */
export function disableAppleCalendar(): void {
  clearTimeout(timer);
  setSetting("calendar_sync", false);
}

export async function openCalendarPrivacySettings(): Promise<void> {
  await invoke("calendar_open_privacy_settings");
}
