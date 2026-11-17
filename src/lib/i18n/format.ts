// Pure locale formatting (no reactive state) so it is easy to unit test.
// LV: 16.11.2026 10:00 and 1 250,00 €.  EN: date order per user setting, €1,250.00.
// Always 24-hour time; weeks start on Monday.

import type { EnDateFormat, Lang } from "../db/types";

const pad = (n: number) => String(n).padStart(2, "0");
const NBSP = " ";

export function formatDate(ts: number, lang: Lang, enFormat: EnDateFormat = "DD/MM/YYYY"): string {
  const d = new Date(ts);
  const dd = pad(d.getDate()), mm = pad(d.getMonth() + 1), yyyy = String(d.getFullYear());
  if (lang === "lv") return `${dd}.${mm}.${yyyy}`;
  if (enFormat === "MM/DD/YYYY") return `${mm}/${dd}/${yyyy}`;
  if (enFormat === "YYYY-MM-DD") return `${yyyy}-${mm}-${dd}`;
  return `${dd}/${mm}/${yyyy}`;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDateTime(ts: number, lang: Lang, enFormat?: EnDateFormat): string {
  return `${formatDate(ts, lang, enFormat)} ${formatTime(ts)}`;
}

export function formatMoney(value: number, lang: Lang): string {
  const neg = value < 0;
  const [int, frac] = Math.abs(value).toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, lang === "lv" ? NBSP : ",");
  const sign = neg ? "-" : "";
  return lang === "lv" ? `${sign}${grouped},${frac}${NBSP}€` : `${sign}€${grouped}.${frac}`;
}

// ── Date helpers used across calendar / reminders ───────────────────────

export const DAY = 86_400_000;

export function startOfDay(ts: number | Date): Date {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(ts: number | Date, days: number): Date {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d;
}

/** Monday of the week containing `ts`. */
export function startOfWeek(ts: number | Date): Date {
  const d = startOfDay(ts);
  return addDays(d, -((d.getDay() + 6) % 7));
}

/** Whole calendar days from `a` to `b` (positive when b is later). DST-safe. */
export function dayDiff(a: number | Date, b: number | Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY);
}

export function sameDay(a: number | Date, b: number | Date): boolean {
  return dayDiff(a, b) === 0;
}

/** "YYYY-MM-DDTHH:MM" for <input type="datetime-local">. */
export function toInputValue(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DD" in local time. */
export function toDateKey(ts: number | Date): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
