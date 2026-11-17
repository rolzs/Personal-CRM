// Two-way Apple Calendar sync rules (pure – no I/O, fully unit tested).
//
// Every reminder that has an event in the "CRM" calendar has a link row with
// the title/start/end last synced. Comparing each side with that snapshot
// tells who changed what:
//   only the CRM changed       → write the event
//   only the calendar changed  → update the reminder
//   both changed               → the CRM wins
//   neither                    → nothing (this is how our own writes echo back harmlessly)

export const URL_PREFIX = "personalcrm://reminder/";
const MIN = 60_000;
export const DEFAULT_EVENT_MINUTES = 30;

export interface CalEvent {
  event_id: string | null;
  url: string | null;
  title: string;
  start: number;
  end: number;
  all_day: boolean;
}

export interface Link {
  reminder_id: string;
  event_id: string | null;
  synced_title: string;
  synced_start: number;
  synced_end: number;
}

export interface SyncReminder {
  id: string;
  title: string;
  datetime: number;
  duration: number | null;
  done: boolean;
  /** Event notes (contact name, company). Written, never read back. */
  notes: string;
}

export interface EventWrite {
  event_id: string | null;
  reminder_id: string;
  title: string;
  notes: string;
  start: number;
  end: number;
}

export interface CrmUpdate {
  id: string;
  title?: string;
  datetime?: number;
  duration?: number | null;
}

export interface CrmCreate {
  event_id: string | null;
  title: string;
  datetime: number;
  duration: number | null;
}

export interface Plan {
  /** Events to create or update (event_id null = create). */
  writes: EventWrite[];
  deleteEvents: string[];
  crmUpdates: CrmUpdate[];
  crmDeletes: string[];
  /** Events added directly in the CRM calendar → new reminders. */
  crmCreates: CrmCreate[];
  /** Links that stay as they are or get new snapshot values. Writes add theirs after saving. */
  keepLinks: Link[];
  /** Reminder ids whose link row must be removed. */
  dropLinks: string[];
}

export interface Window {
  from: number;
  to: number;
}

export function reminderIdFromUrl(url: string | null): string | null {
  return url && url.startsWith(URL_PREFIX) ? url.slice(URL_PREFIX.length) : null;
}

/** The event a reminder should have. */
export function desiredEvent(r: SyncReminder): { title: string; start: number; end: number } {
  return { title: r.title, start: r.datetime, end: r.datetime + (r.duration ?? DEFAULT_EVENT_MINUTES) * MIN };
}

/** Duration in whole minutes; null when it is the default length (keeps "no duration" reminders as they were). */
function durationOf(start: number, end: number, current: number | null): number | null {
  const minutes = Math.max(1, Math.round((end - start) / MIN));
  return current === null && minutes === DEFAULT_EVENT_MINUTES ? null : minutes;
}

const inWindow = (ts: number, w: Window) => ts >= w.from && ts < w.to;

/**
 * @param reminders all CRM reminders (done ones included)
 * @param events    events currently in the CRM calendar within `window`
 * @param links     all link rows
 * @param defaultTime "HH:MM" used for all-day events added in Calendar
 */
export function reconcile(reminders: SyncReminder[], events: CalEvent[], links: Link[], window: Window, defaultTime = "09:00"): Plan {
  const plan: Plan = { writes: [], deleteEvents: [], crmUpdates: [], crmDeletes: [], crmCreates: [], keepLinks: [], dropLinks: [] };
  const reminderById = new Map(reminders.map((r) => [r.id, r]));
  const eventByReminder = new Map<string, CalEvent>();
  const eventById = new Map<string, CalEvent>();
  for (const e of events) {
    if (e.event_id) eventById.set(e.event_id, e);
    const rid = reminderIdFromUrl(e.url);
    if (rid && !eventByReminder.has(rid)) eventByReminder.set(rid, e);
  }
  const claimed = new Set<CalEvent>();
  const write = (r: SyncReminder, eventId: string | null) => {
    const d = desiredEvent(r);
    plan.writes.push({ event_id: eventId, reminder_id: r.id, title: d.title, notes: r.notes, start: d.start, end: d.end });
  };
  const deleteEvent = (e: CalEvent) => { if (e.event_id) plan.deleteEvents.push(e.event_id); };

  // 1. Reminders that were synced before.
  const linked = new Set<string>();
  for (const link of links) {
    linked.add(link.reminder_id);
    const r = reminderById.get(link.reminder_id);
    const e = eventByReminder.get(link.reminder_id) ?? (link.event_id ? eventById.get(link.event_id) : undefined);
    if (e) claimed.add(e);

    if (!r || r.done) {
      // Deleted or done in the CRM → remove the event.
      if (e) deleteEvent(e);
      if (e || !r || inWindow(link.synced_start, window)) plan.dropLinks.push(link.reminder_id);
      else plan.keepLinks.push(link); // event outside the visible window; deal with it when it comes into view
      continue;
    }
    if (!e) {
      if (!inWindow(link.synced_start, window) && !inWindow(r.datetime, window)) {
        plan.keepLinks.push(link); // simply not visible right now
      } else if (!inWindow(link.synced_start, window)) {
        write(r, link.event_id); // moved into view by the CRM
      } else {
        // The event was deleted in Calendar → delete the reminder.
        plan.crmDeletes.push(r.id);
        plan.dropLinks.push(r.id);
      }
      continue;
    }

    const d = desiredEvent(r);
    const crmChanged = d.title !== link.synced_title || d.start !== link.synced_start || d.end !== link.synced_end;
    const calChanged = e.title !== link.synced_title || e.start !== link.synced_start || e.end !== link.synced_end;
    if (crmChanged) {
      write(r, e.event_id); // also wins a conflict
    } else if (calChanged) {
      const update: CrmUpdate = { id: r.id };
      if (e.title !== r.title && e.title.trim()) update.title = e.title;
      if (e.start !== r.datetime) update.datetime = e.start;
      const duration = durationOf(e.start, e.end, r.duration);
      if (duration !== r.duration) update.duration = duration;
      if (Object.keys(update).length > 1) plan.crmUpdates.push(update);
      plan.keepLinks.push({ reminder_id: r.id, event_id: e.event_id, synced_title: e.title, synced_start: e.start, synced_end: e.end });
    } else {
      plan.keepLinks.push({ ...link, event_id: e.event_id ?? link.event_id });
    }
  }

  // 2. Pending reminders never synced (new, or the link was lost e.g. after a restore).
  for (const r of reminders) {
    if (linked.has(r.id) || r.done) continue;
    const e = eventByReminder.get(r.id);
    if (e) {
      claimed.add(e);
      write(r, e.event_id); // adopt the existing event, CRM values win
    } else if (inWindow(r.datetime, window)) {
      write(r, null);
    }
  }

  // 3. Events nobody claimed.
  const [dh, dm] = defaultTime.split(":").map(Number);
  for (const e of events) {
    if (claimed.has(e)) continue;
    const rid = reminderIdFromUrl(e.url);
    if (rid) {
      // Tagged by us, but its reminder is gone or done → remove it.
      const r = reminderById.get(rid);
      if (!r || r.done) deleteEvent(e);
      continue;
    }
    // Added by hand in the CRM calendar → becomes a reminder.
    let datetime = e.start;
    let duration: number | null = durationOf(e.start, e.end, null);
    if (e.all_day) {
      const d = new Date(e.start);
      d.setHours(dh || 9, dm || 0, 0, 0);
      datetime = d.getTime();
      duration = null;
    }
    plan.crmCreates.push({ event_id: e.event_id, title: e.title.trim() || "—", datetime, duration });
  }
  return plan;
}
