// Pure helpers around the Apple Intelligence calls (unit tested):
// building the model input, turning answers into CRM data, and guarding
// against made-up details.

import type { Activity, Contact, Reminder } from "../db/types";
import { parseQuickAdd } from "../quickadd/parser";

/** The on-device model has a small context window; keep requests well inside it. */
export const MAX_CONTEXT_CHARS = 6000;
const MAX_ACTIVITIES = 15;

const iso = (ts: number) => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Plain-text contact record for the model: details, newest activities, open reminders, then notes. */
export function contactContext(contact: Contact, activities: Activity[], reminders: Reminder[], max = MAX_CONTEXT_CHARS): string {
  const head = [
    `Name: ${contact.name}`,
    contact.company && `Company: ${contact.company}`,
    `Status: ${contact.status}`,
    contact.tags.length ? `Tags: ${contact.tags.join(", ")}` : "",
    contact.last_contacted_at ? `Last contacted: ${iso(contact.last_contacted_at)}` : "Never contacted",
  ].filter(Boolean).join("\n");

  const acts = [...activities]
    .filter((a) => a.contact_id === contact.id)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_ACTIVITIES)
    .map((a) => `- ${iso(a.timestamp)} ${a.type}: ${a.text.replace(/\s+/g, " ").trim()}`);
  const open = reminders
    .filter((r) => r.contact_id === contact.id && !r.done)
    .sort((a, b) => a.datetime - b.datetime)
    .map((r) => `- ${iso(r.datetime)} ${r.title}`);

  let text = head;
  if (acts.length) text += `\n\nActivities (newest first):\n${acts.join("\n")}`;
  if (open.length) text += `\n\nOpen reminders:\n${open.join("\n")}`;
  const notes = contact.notes.trim();
  if (notes) text += `\n\nNotes:\n${notes}`;
  // Notes go last so that, if anything has to be cut, it is the tail of the notes.
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** "Tuesday, 17 November 2026" – the model needs today's date to place "next week" etc. */
export function todayLabel(now: Date): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
}

/**
 * Turn the model's `when` phrase ("tomorrow 10:00", "in 3 days", "next week")
 * into a timestamp with the app's own quick-add parser. Unrecognised → tomorrow
 * at the default time. Never in the past.
 */
export function nextStepTime(when: string, defaultTime: string, now: Date): number {
  const parsed = parseQuickAdd(when, { now, defaultTime });
  if (!parsed.hasDate && !parsed.hasTime) {
    return parseQuickAdd("tomorrow", { now, defaultTime }).datetime.getTime();
  }
  const ts = parsed.datetime.getTime();
  return ts > now.getTime() ? ts : now.getTime() + 3_600_000;
}

export interface PersonDraft {
  name: string;
  title: string;
  company: string;
  email: string;
  phone: string;
}

const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Keep only what is really in the pasted text: an email or phone the model
 * returns must appear in the source (phones compared by digits), otherwise it
 * is dropped. Entries with neither a name nor any contact detail are removed,
 * and duplicates (same email or name) are merged away.
 */
export function validateExtracted(drafts: PersonDraft[], source: string): PersonDraft[] {
  const lowerSource = source.toLowerCase();
  const sourceDigits = digits(source);
  const seen = new Set<string>();
  const out: PersonDraft[] = [];
  for (const d of drafts) {
    const clean: PersonDraft = {
      name: (d.name ?? "").replace(/\s+/g, " ").trim(),
      title: (d.title ?? "").replace(/\s+/g, " ").trim(),
      company: (d.company ?? "").replace(/\s+/g, " ").trim(),
      email: (d.email ?? "").trim(),
      phone: (d.phone ?? "").replace(/\s+/g, " ").trim(),
    };
    if (clean.email && !lowerSource.includes(clean.email.toLowerCase())) clean.email = "";
    // The model sometimes turns an email domain into a "company" (kekavafoods.lv).
    if (/^[\w-]+(\.[\w-]+)+$/.test(clean.company) || !lowerSource.includes(clean.company.toLowerCase())) clean.company = "";
    const pd = digits(clean.phone);
    if (clean.phone && (pd.length < 7 || !sourceDigits.includes(pd))) clean.phone = "";
    if (clean.name && !lowerSource.includes(clean.name.toLowerCase().split(" ")[0])) {
      // A name that is not in the text at all is invented; keep the entry only if it has real details.
      clean.name = "";
    }
    if (!clean.name && !clean.email && !clean.phone) continue;
    const key = (clean.email || clean.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}
