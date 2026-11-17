// iCalendar (.ics) export for Apple Calendar – single reminder or everything.

import type { Reminder } from "../db/types";

const pad = (n: number) => String(n).padStart(2, "0");

/** UTC timestamp in iCalendar basic format: 20261116T080000Z */
function icsDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets must be folded; fold conservatively by characters. */
function foldLine(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 60) {
    out.push(rest.slice(0, 60));
    rest = " " + rest.slice(60);
  }
  out.push(rest);
  return out.join("\r\n");
}

const RRULE = { daily: "FREQ=DAILY", weekly: "FREQ=WEEKLY", monthly: "FREQ=MONTHLY" } as const;

export function toIcs(reminders: Reminder[], contactName: (id: string | null) => string | undefined): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Personal CRM//LV", "CALSCALE:GREGORIAN"];
  const stamp = icsDate(Date.now());
  for (const r of reminders) {
    const name = contactName(r.contact_id);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${r.id}@personalcrm.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(r.datetime)}`,
      `DTEND:${icsDate(r.datetime + (r.duration ?? 30) * 60_000)}`,
      `SUMMARY:${escapeText(r.title)}`,
    );
    if (name) lines.push(`DESCRIPTION:${escapeText(name)}`);
    if (r.repeat !== "none") lines.push(`RRULE:${RRULE[r.repeat]}`);
    if (r.done) lines.push("STATUS:CANCELLED");
    else lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(r.title)}`, "TRIGGER:PT0M", "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
