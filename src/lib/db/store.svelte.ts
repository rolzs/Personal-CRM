// The single source of truth for the UI.
//
// Everything is loaded into memory once at startup; views are derived from
// this reactive state, so every action is instant (no spinners). Writes are
// applied to memory immediately and persisted to SQLite in the background
// through a serialised queue.
//
// Every mutation runs inside `tx()`, which records the inverse operations
// and pushes them on the undo stack (Cmd+Z / toast "Undo").

import { openDb, type Db } from "./client";
import {
  COLUMNS, DEFAULT_SETTINGS,
  type Activity, type ActivityType, type Contact, type Deal, type Reminder,
  type Settings, type TableName, type Tables,
} from "./types";
import { locale, t } from "../i18n/index.svelte";
import { toast } from "../ui/state.svelte";

export const data = $state({
  loaded: false,
  contacts: [] as Contact[],
  deals: [] as Deal[],
  activities: [] as Activity[],
  reminders: [] as Reminder[],
  settings: { ...DEFAULT_SETTINGS } as Settings,
});

let db: Db;
let queue: Promise<unknown> = Promise.resolve();
/** Called (debounced) after any data change – used for native sync. */
let onChange: (() => void) | null = null;
let changeTimer: ReturnType<typeof setTimeout> | undefined;

export const newId = () => crypto.randomUUID();

// ── Persistence ─────────────────────────────────────────────────────────

function persist(sql: string, params: unknown[]): void {
  queue = queue
    .then(() => db.execute(sql, params))
    .catch((err) => {
      console.error("DB write failed", sql, err);
      toast(t("toast.db_error"), { error: true });
    });
}

/** Resolves once every queued write has reached SQLite. */
export function flush(): Promise<unknown> {
  return queue;
}

/** JS value → SQLite value. */
function enc(v: unknown): unknown {
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return v ?? null;
}

function decodeRow<T extends TableName>(table: T, row: Record<string, unknown>): Tables[T] {
  if (table === "contacts") {
    let tags: string[] = [];
    try { tags = JSON.parse(String(row.tags ?? "[]")); } catch { /* keep [] */ }
    return { ...row, tags } as unknown as Tables[T];
  }
  if (table === "reminders") return { ...row, done: !!row.done } as unknown as Tables[T];
  return row as unknown as Tables[T];
}

function changed(): void {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => onChange?.(), 30);
}

export function setOnChange(fn: () => void): void {
  onChange = fn;
}

// ── Low-level row operations (record their own inverse) ─────────────────

type Inverse = () => void;
interface UndoEntry { label: string; inverses: Inverse[] }

let recording: Inverse[] | null = null;
const undoStack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];

function rows<T extends TableName>(table: T): Tables[T][] {
  return data[table] as Tables[T][];
}

function rawInsert<T extends TableName>(table: T, row: Tables[T]): void {
  rows(table).push(row);
  const cols = COLUMNS[table] as readonly string[];
  persist(
    `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    cols.map((c) => enc((row as unknown as Record<string, unknown>)[c])),
  );
  recording?.push(() => rawDelete(table, row.id));
}

function rawUpdate<T extends TableName>(table: T, id: string, patch: Partial<Tables[T]>): void {
  const row = rows(table).find((r) => r.id === id) as Record<string, unknown> | undefined;
  if (!row) return;
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const before: Record<string, unknown> = {};
  for (const k of keys) before[k] = $state.snapshot(row[k]);
  Object.assign(row, patch);
  persist(
    `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
    [...keys.map((k) => enc((patch as Record<string, unknown>)[k])), id],
  );
  recording?.push(() => rawUpdate(table, id, before as Partial<Tables[T]>));
}

function rawDelete<T extends TableName>(table: T, id: string): void {
  const list = rows(table);
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return;
  const snapshot = $state.snapshot(list[i]) as Tables[T];
  list.splice(i, 1);
  persist(`DELETE FROM ${table} WHERE id = ?`, [id]);
  recording?.push(() => rawInsert(table, snapshot));
}

/**
 * Run `fn` as one undoable action. `label` is an i18n key under "undo.".
 * With `announce`, a toast with an Undo button is shown.
 */
export function tx<R>(label: string, fn: () => R, announce = false): R {
  if (recording) return fn(); // nested → part of the outer action
  recording = [];
  try {
    return fn();
  } finally {
    const inverses = recording;
    recording = null;
    if (inverses.length) {
      undoStack.push({ label, inverses });
      if (undoStack.length > 100) undoStack.shift();
      redoStack.length = 0;
      if (announce) toast(t(`undo.${label}`), { undoable: true });
    }
    changed();
  }
}

function replay(from: UndoEntry[], to: UndoEntry[], messageKey: string): boolean {
  const entry = from.pop();
  if (!entry) return false;
  // Running the inverses records *their* inverses, which become the redo/undo entry.
  recording = [];
  for (const inverse of [...entry.inverses].reverse()) inverse();
  to.push({ label: entry.label, inverses: recording });
  recording = null;
  changed();
  toast(t(messageKey, { action: t(`undo.${entry.label}`) }));
  return true;
}

export function undo(): boolean {
  const ok = replay(undoStack, redoStack, "toast.undone");
  if (!ok) toast(t("toast.nothing_to_undo"));
  return ok;
}

export function redo(): boolean {
  return replay(redoStack, undoStack, "toast.redone");
}

// ── Loading ─────────────────────────────────────────────────────────────

export async function initStore(): Promise<void> {
  db = await openDb();
  await reload();
  data.loaded = true;
}

/** (Re)read everything from SQLite – at startup and when another window changed data. */
export async function reload(): Promise<void> {
  await flush();
  const [contacts, deals, activities, reminders, settings] = await Promise.all([
    db.select<Record<string, unknown>>("SELECT * FROM contacts"),
    db.select<Record<string, unknown>>("SELECT * FROM deals"),
    db.select<Record<string, unknown>>("SELECT * FROM activities"),
    db.select<Record<string, unknown>>("SELECT * FROM reminders"),
    db.select<{ key: string; value: string }>("SELECT key, value FROM settings"),
  ]);
  data.contacts = contacts.map((r) => decodeRow("contacts", r));
  data.deals = deals.map((r) => decodeRow("deals", r));
  data.activities = activities.map((r) => decodeRow("activities", r));
  data.reminders = reminders.map((r) => decodeRow("reminders", r));
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const { key, value } of settings) {
    if (key in merged) {
      try { merged[key] = JSON.parse(value); } catch { /* ignore broken value */ }
    }
  }
  data.settings = merged as unknown as Settings;
  locale.lang = data.settings.language;
  locale.enDateFormat = data.settings.en_date_format;
}

export async function closeDb(): Promise<void> {
  await flush();
  await db.close();
}

/** Queue a write to a table the store does not keep in memory (calendar_links). */
export function execute(sql: string, params: unknown[] = []): void {
  persist(sql, params);
}

/** Read rows after all queued writes have landed. */
export async function select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  await flush();
  return db.select<T>(sql, params);
}

/** Run a read-only statement (e.g. PRAGMA wal_checkpoint before a backup). */
export async function rawSelect<T>(sql: string): Promise<T[]> {
  await flush();
  return db.select<T>(sql);
}

// ── Settings (not undoable) ─────────────────────────────────────────────

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  data.settings[key] = value;
  if (key === "language") locale.lang = value as Settings["language"];
  if (key === "en_date_format") locale.enDateFormat = value as Settings["en_date_format"];
  persist(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, JSON.stringify(value)],
  );
}

// ── Lookups ─────────────────────────────────────────────────────────────

export const contactById = (id: string | null | undefined) =>
  id ? data.contacts.find((c) => c.id === id) : undefined;
export const dealById = (id: string | null | undefined) =>
  id ? data.deals.find((d) => d.id === id) : undefined;

/** When a reminder should fire: the snooze target if snoozed, else its datetime. */
export const effectiveTime = (r: Reminder) => r.snoozed_until ?? r.datetime;

/** Earliest pending reminder for a contact. */
export function nextReminderFor(contactId: string): Reminder | undefined {
  let best: Reminder | undefined;
  for (const r of data.reminders) {
    if (r.contact_id === contactId && !r.done && (!best || effectiveTime(r) < effectiveTime(best))) best = r;
  }
  return best;
}

// ── Contacts ────────────────────────────────────────────────────────────

export function createContact(partial: Partial<Contact> = {}): Contact {
  const now = Date.now();
  const contact: Contact = {
    id: newId(), name: "", company: "", email: "", phone: "", tags: [], status: "lead", notes: "",
    created_at: now, updated_at: now, last_contacted_at: null, is_sample: 0, ...partial,
  };
  tx("contact_created", () => rawInsert("contacts", contact), true);
  return contact;
}

export function updateContact(id: string, patch: Partial<Contact>): void {
  tx("contact_updated", () => rawUpdate("contacts", id, { ...patch, updated_at: Date.now() }));
}

export function deleteContact(id: string): void {
  tx("contact_deleted", () => {
    for (const r of data.reminders.filter((r) => r.contact_id === id)) rawDelete("reminders", r.id);
    for (const a of data.activities.filter((a) => a.contact_id === id)) rawDelete("activities", a.id);
    for (const d of data.deals.filter((d) => d.contact_id === id)) rawDelete("deals", d.id);
    rawDelete("contacts", id);
  }, true);
}

// ── Activities ──────────────────────────────────────────────────────────

/** last_contacted_at always mirrors the newest activity of the contact. */
function refreshLastContacted(contactId: string): void {
  let last: number | null = null;
  for (const a of data.activities) {
    if (a.contact_id === contactId && (last === null || a.timestamp > last)) last = a.timestamp;
  }
  const c = contactById(contactId);
  if (c && c.last_contacted_at !== last) rawUpdate("contacts", contactId, { last_contacted_at: last });
}

export function logActivity(contactId: string, type: ActivityType, text: string, timestamp = Date.now()): Activity {
  const activity: Activity = { id: newId(), contact_id: contactId, type, text, timestamp, is_sample: 0 };
  tx("activity_logged", () => {
    rawInsert("activities", activity);
    refreshLastContacted(contactId);
  }, true);
  return activity;
}

export function updateActivity(id: string, patch: Partial<Activity>): void {
  tx("activity_updated", () => {
    rawUpdate("activities", id, patch);
    const a = data.activities.find((a) => a.id === id);
    if (a) refreshLastContacted(a.contact_id);
  });
}

export function deleteActivity(id: string): void {
  const a = data.activities.find((a) => a.id === id);
  if (!a) return;
  tx("activity_deleted", () => {
    rawDelete("activities", id);
    refreshLastContacted(a.contact_id);
  }, true);
}

// ── Deals ───────────────────────────────────────────────────────────────

export function createDeal(partial: Partial<Deal> = {}): Deal {
  const now = Date.now();
  const deal: Deal = {
    id: newId(), contact_id: null, title: "", value: 0, stage: "new", due_date: null, notes: "",
    created_at: now, updated_at: now, is_sample: 0, ...partial,
  };
  tx("deal_created", () => rawInsert("deals", deal), true);
  return deal;
}

export function updateDeal(id: string, patch: Partial<Deal>): void {
  tx("deal_updated", () => rawUpdate("deals", id, { ...patch, updated_at: Date.now() }));
}

export function deleteDeal(id: string): void {
  tx("deal_deleted", () => {
    for (const r of data.reminders.filter((r) => r.deal_id === id)) rawUpdate("reminders", r.id, { deal_id: null });
    rawDelete("deals", id);
  }, true);
}

// ── Reminders / events ──────────────────────────────────────────────────

export function createReminder(partial: Partial<Reminder> & { title: string; datetime: number }): Reminder {
  const reminder: Reminder = {
    id: newId(), duration: null, contact_id: null, deal_id: null, done: false, done_at: null,
    repeat: "none", snoozed_until: null, created_at: Date.now(), is_sample: 0, ...partial,
  };
  tx("reminder_created", () => rawInsert("reminders", reminder), true);
  return reminder;
}

export function updateReminder(id: string, patch: Partial<Reminder>): void {
  // Moving a reminder clears any snooze so it fires at the new time.
  const full = "datetime" in patch ? { snoozed_until: null, ...patch } : patch;
  tx("reminder_updated", () => rawUpdate("reminders", id, full));
}

export function deleteReminder(id: string): void {
  tx("reminder_deleted", () => rawDelete("reminders", id), true);
}

function nextOccurrence(r: Reminder): number {
  const d = new Date(r.datetime);
  const now = Date.now();
  // Step forward until the next occurrence is in the future.
  do {
    if (r.repeat === "daily") d.setDate(d.getDate() + 1);
    else if (r.repeat === "weekly") d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
  } while (d.getTime() <= now);
  return d.getTime();
}

/** Mark done / not done. Completing a repeating reminder schedules the next one. */
export function setReminderDone(id: string, done: boolean): void {
  const r = data.reminders.find((r) => r.id === id);
  if (!r || r.done === done) return;
  tx(done ? "reminder_done" : "reminder_reopened", () => {
    rawUpdate("reminders", id, { done, done_at: done ? Date.now() : null, snoozed_until: null });
    if (done && r.repeat !== "none") {
      rawInsert("reminders", {
        ...($state.snapshot(r) as Reminder),
        id: newId(), datetime: nextOccurrence(r), done: false, done_at: null, snoozed_until: null,
        created_at: Date.now(),
      });
    }
  }, true);
}

export function snoozeReminder(id: string, minutes: number): void {
  tx("reminder_snoozed", () => rawUpdate("reminders", id, { snoozed_until: Date.now() + minutes * 60_000 }), true);
}

// ── Bulk operations (import, sample data) ───────────────────────────────

export interface Dump {
  app: "personal-crm";
  version: 1;
  exported_at: string;
  contacts: Contact[];
  deals: Deal[];
  activities: Activity[];
  reminders: Reminder[];
  settings: Settings;
}

export function exportDump(): Dump {
  return {
    app: "personal-crm",
    version: 1,
    exported_at: new Date().toISOString(),
    contacts: $state.snapshot(data.contacts) as Contact[],
    deals: $state.snapshot(data.deals) as Deal[],
    activities: $state.snapshot(data.activities) as Activity[],
    reminders: $state.snapshot(data.reminders) as Reminder[],
    settings: $state.snapshot(data.settings) as Settings,
  };
}

/** Replace the whole database with an exported JSON dump. Not undoable (a backup is taken first). */
export async function importDump(dump: Dump): Promise<void> {
  if (dump?.app !== "personal-crm" || !Array.isArray(dump.contacts)) throw new Error("invalid_dump");
  recording = null;
  undoStack.length = 0;
  redoStack.length = 0;
  // Children first so foreign keys are never violated.
  for (const table of ["reminders", "activities", "deals", "contacts"] as TableName[]) {
    persist(`DELETE FROM ${table}`, []);
    data[table].length = 0;
  }
  for (const table of ["contacts", "deals", "activities", "reminders"] as TableName[]) {
    for (const row of (dump[table] ?? []) as Tables[typeof table][]) rawInsert(table, row as never);
  }
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (dump.settings && key in dump.settings) setSetting(key, dump.settings[key] as never);
  }
  await flush();
  await reload();
  changed();
}

/** Insert many rows as one undo-less batch (seed data). */
export function insertBatch(batch: { [T in TableName]?: Tables[T][] }): void {
  for (const table of ["contacts", "deals", "activities", "reminders"] as TableName[]) {
    for (const row of batch[table] ?? []) rawInsert(table, row as never);
  }
  changed();
}

export const hasSampleData = () =>
  data.contacts.some((c) => c.is_sample) || data.reminders.some((r) => r.is_sample);

/** "Clear sample data": removes every row flagged is_sample (undoable). */
export function clearSampleData(): void {
  tx("sample_cleared", () => {
    for (const table of ["reminders", "activities", "deals", "contacts"] as TableName[]) {
      for (const row of rows(table).filter((r) => r.is_sample)) rawDelete(table, row.id);
    }
  }, true);
}
