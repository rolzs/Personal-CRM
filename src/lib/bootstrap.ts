// Startup wiring shared by the three windows.
//  * main:   owns seeding, native sync (reminders → scheduler/tray), menu events,
//            notification actions, periodic jobs.
//  * others: just load data and keep it in sync.

import { contactById, data, effectiveTime, flush, initStore, redo, reload, setOnChange, setReminderDone, setSetting, snoozeReminder, undo } from "./db/store.svelte";
import { autoBackupIfDue, backupNowWithToast, exportAllIcs, exportJson } from "./db/backup";
import { seedSampleData } from "./db/seed";
import { emit, invoke, listen, requestNotificationPermission, type WindowKind } from "./native";
import { applyAllSettings } from "./settings/apply";
import { refreshCalendarStatus, scheduleCalendarSync } from "./calendar/appleSync.svelte";
import { createContact } from "./db/store.svelte";
import { t } from "./i18n/index.svelte";
import { openContact, ui, type View } from "./ui/state.svelte";

/** Tell the Rust scheduler which reminders are pending (also updates the tray badge). */
export function syncNative(): void {
  const items = data.reminders
    .filter((r) => !r.done)
    .map((r) => ({ id: r.id, title: r.title, body: contactById(r.contact_id)?.name ?? "", at: effectiveTime(r) }));
  void invoke("sync_reminders", { items });
}

export function newContact(): void {
  ui.view = "contacts";
  ui.contactStatus = "";
  const c = createContact({ name: t("contacts.new_name") });
  ui.focusName = true;
  ui.selectedContactId = c.id;
}

/** Cmd+Z: normal text undo while typing, otherwise undo the last CRM action. */
export function smartUndo(isRedo = false): void {
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) document.execCommand(isRedo ? "redo" : "undo");
  else if (isRedo) redo();
  else undo();
}

function handleMenu(id: string): void {
  const views: Record<string, View> = { view_summary: "summary", view_contacts: "contacts", view_calendar: "calendar", view_activities: "activities", settings: "settings" };
  if (views[id]) ui.view = views[id];
  else if (id === "new_contact") newContact();
  else if (id === "quick_add") ui.quickAddOpen = true;
  else if (id === "search") { if (ui.view !== "activities") ui.view = "contacts"; ui.focusSearch++; }
  else if (id === "undo") smartUndo();
  else if (id === "redo") smartUndo(true);
  else if (id === "shortcuts") ui.cheatOpen = true;
  else if (id === "backup_now") void backupNowWithToast();
  else if (id === "export_json") void exportJson();
  else if (id === "export_ics") void exportAllIcs();
}

function handleReminderAction({ id, action }: { id: string; action: string }): void {
  const r = data.reminders.find((x) => x.id === id);
  if (!r) return;
  if (action === "snooze15") snoozeReminder(id, 15);
  else if (action === "snooze60") snoozeReminder(id, 60);
  else if (action === "done") setReminderDone(id, true);
  else if (action === "click") {
    // Clicking the notification opens the related contact (or the calendar).
    if (r.contact_id) openContact(r.contact_id);
    else ui.view = "calendar";
  }
}

export async function bootstrap(kind: WindowKind): Promise<void> {
  await initStore();

  // Every window announces its changes; the others reload from SQLite.
  setOnChange(() => {
    if (kind === "main") { syncNative(); scheduleCalendarSync(); }
    void flush().then(() => emit("data-changed", kind));
  });
  await listen<string>("data-changed", (source) => {
    if (source !== kind) void reload().then(() => { if (kind === "main") { syncNative(); scheduleCalendarSync(); } });
  });

  if (kind !== "main") return;

  if (!data.settings.seeded) {
    seedSampleData();
    setSetting("seeded", true);
  }

  // Reminders that became due while the app was not running.
  const now = Date.now();
  const lastRun = data.settings.last_run_at;
  if (lastRun > 0) {
    ui.missed = data.reminders
      .filter((r) => !r.done && effectiveTime(r) > lastRun && effectiveTime(r) <= now)
      .map((r) => r.id);
  }
  setSetting("last_run_at", now);

  await applyAllSettings();
  syncNative();
  if (!data.settings.notifications_asked) {
    setSetting("notifications_asked", true);
    void requestNotificationPermission();
  }
  void autoBackupIfDue();

  await listen<string>("menu", handleMenu);
  await listen<{ id: string; action: string }>("reminder-action", handleReminderAction);
  await listen<string>("open-contact", (id) => openContact(id));

  // Two-way Apple Calendar sync: EventKit reports edits made in Calendar.app / on the iPhone.
  await listen("calendar-changed", () => scheduleCalendarSync());
  if (data.settings.calendar_sync) void refreshCalendarStatus().then(() => scheduleCalendarSync(0));

  // The Rust scheduler ticks every few seconds, even while the window is hidden.
  let lastMinute = 0;
  const periodic = () => {
    ui.now = Date.now();
    if (ui.now - lastMinute >= 60_000) {
      lastMinute = ui.now;
      setSetting("last_run_at", ui.now);
      void autoBackupIfDue();
    }
  };
  await listen("tick", periodic);
  setInterval(periodic, 30_000); // also covers the browser preview
}
