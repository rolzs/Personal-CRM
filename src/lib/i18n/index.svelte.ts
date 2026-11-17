// i18n: every UI string comes from locales/lv.json or locales/en.json.
// `locale` is reactive state, so switching language re-renders instantly.

import lv from "../../../locales/lv.json";
import en from "../../../locales/en.json";
import type { EnDateFormat, Lang } from "../db/types";
import { dayDiff, formatDate, formatDateTime, formatMoney, formatTime } from "./format";

type Dict = { [key: string]: string | string[] | Dict };
const DICTS: Record<Lang, Dict> = { lv: lv as Dict, en: en as Dict };

export const locale = $state({ lang: "lv" as Lang, enDateFormat: "DD/MM/YYYY" as EnDateFormat });

function lookup(lang: Lang, key: string): string | string[] | undefined {
  let node: string | string[] | Dict | undefined = DICTS[lang];
  for (const part of key.split(".")) {
    if (node === undefined || typeof node === "string" || Array.isArray(node)) return undefined;
    node = node[part];
  }
  return typeof node === "string" || Array.isArray(node) ? node : undefined;
}

/** Translate `key`, replacing `{name}` placeholders. Falls back to English, then the key. */
export function t(key: string, params?: Record<string, string | number>): string {
  const raw = lookup(locale.lang, key) ?? lookup("en", key);
  if (typeof raw !== "string") return key;
  return params ? raw.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? "")) : raw;
}

/** Plural-aware translate: picks `key_one` or `key_other` (Latvian: 1, 21, 31 … are singular). */
export function tn(key: string, n: number, params: Record<string, string | number> = {}): string {
  const one = locale.lang === "lv" ? n % 10 === 1 && n % 100 !== 11 : n === 1;
  return t(`${key}_${one ? "one" : "other"}`, { n, ...params });
}

/** String arrays such as weekday / month names. */
export function tList(key: string): string[] {
  const raw = lookup(locale.lang, key) ?? lookup("en", key);
  return Array.isArray(raw) ? raw : [];
}

export const fmtDate = (ts: number) => formatDate(ts, locale.lang, locale.enDateFormat);
export const fmtTime = (ts: number) => formatTime(ts);
export const fmtDateTime = (ts: number) => formatDateTime(ts, locale.lang, locale.enDateFormat);
export const fmtMoney = (v: number) => formatMoney(v, locale.lang);

/** "Šodien 10:00" / "Rīt 09:00" / "Vakar 14:30" / "Pk 20.11.2026 10:00". */
export function fmtWhen(ts: number, now: number = Date.now()): string {
  const diff = dayDiff(now, ts);
  const time = formatTime(ts);
  if (diff === 0) return `${t("date.today")} ${time}`;
  if (diff === 1) return `${t("date.tomorrow")} ${time}`;
  if (diff === -1) return `${t("date.yesterday")} ${time}`;
  const wd = tList("date.weekdays_short")[(new Date(ts).getDay() + 6) % 7] ?? "";
  return `${wd} ${fmtDate(ts)} ${time}`;
}

/** "šodien" / "pirms 5 dienām" – used for "last contacted". */
export function fmtDaysAgo(ts: number, now: number = Date.now()): string {
  const days = Math.max(0, dayDiff(ts, now));
  return days === 0 ? t("date.today").toLowerCase() : tn("date.days_ago", days);
}
