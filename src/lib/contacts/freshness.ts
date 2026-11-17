// "Last contacted" colour hint: green < 14 days, yellow < 30, red ≥ 30.

import type { Contact } from "../db/types";
import { dayDiff } from "../i18n/format";

/** Days since the last activity; null when the contact was never contacted. */
export function daysSinceContact(c: Contact, now: number): number | null {
  return c.last_contacted_at === null ? null : Math.max(0, dayDiff(c.last_contacted_at, now));
}

export function freshness(c: Contact, now: number): "green" | "yellow" | "red" {
  const days = daysSinceContact(c, now);
  if (days === null) return "red";
  return days < 14 ? "green" : days < 30 ? "yellow" : "red";
}

/** Days without any touch (falls back to the creation date) – used for the "not touched in N days" list. */
export function daysUntouched(c: Contact, now: number): number {
  return Math.max(0, dayDiff(c.last_contacted_at ?? c.created_at, now));
}
