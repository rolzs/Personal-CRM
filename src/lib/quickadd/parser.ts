// Quick-add parser for Latvian and English, e.g.
//   "Zvanīt Jānim rīt 10:00 par rēķinu"  /  "Call Janis tomorrow 10:00 re invoice"
// → title "Zvanīt Jānim par rēķinu", tomorrow 10:00, linked to contact "Jānis …".
//
// Both languages are always understood, whatever the UI language is.
// Pure functions only (no app state) so everything here is unit-testable.

export interface NamedContact {
  id: string;
  name: string;
}

export interface ParseOptions {
  /** "Now" – injected so tests are deterministic. */
  now: Date;
  /** Time used when only a day is given, "HH:MM" (setting, default 09:00). */
  defaultTime?: string;
  contacts?: NamedContact[];
  /** Calendar quick-create: the clicked day/slot. Used unless the text names another date. */
  baseDate?: Date;
  /** With baseDate: the slot already has a time (week view), so keep it. */
  baseHasTime?: boolean;
}

export interface ParseResult {
  /** Input with the date/time words removed. */
  title: string;
  datetime: Date;
  /** Whether the text itself contained a date / a time. */
  hasDate: boolean;
  hasTime: boolean;
  /** Contacts found in the text, best first. More than one → show a picker. */
  matches: NamedContact[];
}

// ── Diacritics ──────────────────────────────────────────────────────────

/** Lower-case and strip diacritics char by char (length is preserved): "Bērziņš" → "berzins". */
export function fold(s: string): string {
  let out = "";
  for (const ch of s) {
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    // Keep string length identical so match positions map back to the original.
    out += ch.length === 1 ? (base[0] ?? ch) : ch;
  }
  return out;
}

// ── Contact names with Latvian case endings ─────────────────────────────

/** Nominative endings of Latvian names (after folding š → s). Longest first. */
const NOMINATIVE_ENDINGS = ["is", "us", "s", "a", "e"];
/**
 * What may follow the stem in any case (nominative, genitive, dative,
 * accusative, locative, vocative; all declensions; "j" covers Gulbis → Gulbja).
 * Folding already neutralises palatalisation such as Jānis → Jāņa, Kārlis → Kārļa.
 */
const CASE_SUFFIXES = new Set([
  "s", "is", "us", "a", "e", "i", "u",
  "am", "im", "um", "ai", "ei", "as", "es",
  "ja", "jam", "ju",
]);

/** Does `word` look like some grammatical case of the single name `part`? */
export function matchesName(word: string, part: string): boolean {
  const w = fold(word);
  const p = fold(part);
  if (w === p) return true;
  if (p.length < 3) return false;
  for (const ending of NOMINATIVE_ENDINGS) {
    if (p.endsWith(ending) && p.length - ending.length >= 2) {
      const stem = p.slice(0, -ending.length);
      return w.startsWith(stem) && CASE_SUFFIXES.has(w.slice(stem.length));
    }
  }
  return false; // indeclinable name (e.g. "Hugo") – exact match only
}

/** Find contacts mentioned in `text`. Returns the best-scoring group. */
export function matchContacts(text: string, contacts: NamedContact[]): NamedContact[] {
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!words.length) return [];
  const scored: { c: NamedContact; parts: number; exact: number }[] = [];
  for (const c of contacts) {
    let parts = 0, exact = 0;
    for (const part of c.name.split(/\s+/).filter(Boolean)) {
      const hit = words.find((w) => matchesName(w, part));
      if (hit) {
        parts++;
        if (fold(hit) === fold(part)) exact++;
      }
    }
    if (parts) scored.push({ c, parts, exact });
  }
  if (!scored.length) return [];
  // Prefer contacts where more name parts (first + last name) were mentioned.
  const best = Math.max(...scored.map((s) => s.parts));
  return scored
    .filter((s) => s.parts === best)
    .sort((a, b) => b.exact - a.exact || a.c.name.localeCompare(b.c.name))
    .map((s) => s.c);
}

// ── Date / time ─────────────────────────────────────────────────────────

const WEEKDAYS: Record<string, number> = {
  // Monday = 0 … Sunday = 6
  pirmdien: 0, otrdien: 1, tresdien: 2, ceturtdien: 3, piektdien: 4, sestdien: 5, svetdien: 6,
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6,
};

const RE = {
  // "pēc stundas", "pēc 2 stundām", "in 1 hour", "in an hour"
  hours: /\b(?:pec|in)\s+(?:(\d+|an?)\s+)?(?:stundas|stundam|stundu|hours?)\b/,
  // "pēc 15 minūtēm", "in 15 min"
  minutes: /\b(?:pec|in)\s+(\d+)\s*(?:minut\w*|min)\b/,
  dayAfter: /\b(?:parit|day\s+after\s+tomorrow)\b/,
  tomorrow: /\b(?:ritdien|rit|tomorrow)\b/,
  today: /\b(?:sodien|today)\b/,
  // "pēc 3 dienām", "in 3 days"
  days: /\b(?:pec|in)\s+(\d+)\s+(?:dienam|dienas|diena|days?)\b/,
  // "pēc nedēļas", "pēc 2 nedēļām", "in 2 weeks"
  weeks: /\b(?:pec|in)\s+(?:(\d+|a)\s+)?(?:nedelam|nedelas|weeks?)\b/,
  nextWeek: /\b(?:nakamnedel|nakosnedel|nakamaja\s+nedela|next\s+week)\b/,
  weekday: new RegExp(`\\b(?:on\\s+)?(${Object.keys(WEEKDAYS).join("|")})a?\\b`),
  // 16.11. / 16.11.2026 and 2026-11-16
  dotDate: /\b(\d{1,2})\.(\d{1,2})\.(\d{4})?(?!\d)/,
  isoDate: /\b(\d{4})-(\d{2})-(\d{2})\b/,
  // "plkst. 10", "plkst 10:30", "at 10", "at 10pm", "@10"
  prefixedTime: /(?:\b(?:plkst\.?|pulksten|at)|@)\s*(\d{1,2})(?:[:.](\d{2}))?(?:\s*(am|pm))?\b/,
  // "10:00"
  clock: /\b(\d{1,2}):(\d{2})\b/,
  // "10am", "3 pm"
  ampm: /\b(\d{1,2})\s*(am|pm)\b/,
};

function atTime(day: Date, h: number, m: number): Date {
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

function plusDays(day: Date, n: number): Date {
  const d = new Date(day);
  d.setDate(d.getDate() + n);
  return d;
}

function parseHHMM(s: string | undefined): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? "");
  return m ? [Math.min(23, +m[1]), Math.min(59, +m[2])] : [9, 0];
}

function to24h(hour: number, ampm: string | undefined): number {
  if (ampm === "pm" && hour < 12) return hour + 12;
  if (ampm === "am" && hour === 12) return 0;
  return hour;
}

export function parseQuickAdd(input: string, opts: ParseOptions): ParseResult {
  const now = opts.now;
  const today = atTime(now, 0, 0);
  const [defH, defM] = parseHHMM(opts.defaultTime);

  // `work` is the folded text; recognised pieces are blanked out in it and
  // marked in `removed` so the title can be rebuilt from the original text.
  let work = fold(input);
  const removed = new Array<boolean>(input.length).fill(false);
  const take = (re: RegExp, valid: (m: RegExpExecArray) => boolean = () => true): RegExpExecArray | null => {
    const m = re.exec(work);
    if (!m || !valid(m)) return null;
    work = work.slice(0, m.index) + " ".repeat(m[0].length) + work.slice(m.index + m[0].length);
    for (let i = m.index; i < m.index + m[0].length; i++) removed[i] = true;
    return m;
  };
  const count = (s: string | undefined) => (s && /^\d+$/.test(s) ? +s : 1);

  let exact: Date | null = null; // "in 2 hours" – fully determined
  let day: Date | null = null;
  let time: [number, number] | null = null;
  let m: RegExpExecArray | null;

  // 1. Relative offsets from now.
  if ((m = take(RE.hours))) exact = new Date(now.getTime() + count(m[1]) * 3_600_000);
  else if ((m = take(RE.minutes))) exact = new Date(now.getTime() + +m[1] * 60_000);

  // 2. Day.
  if (!exact) {
    if (take(RE.dayAfter)) day = plusDays(today, 2);
    else if (take(RE.tomorrow)) day = plusDays(today, 1);
    else if (take(RE.today)) day = today;
    else if ((m = take(RE.days))) day = plusDays(today, +m[1]);
    else if ((m = take(RE.weeks))) day = plusDays(today, 7 * count(m[1]));
    else if ((m = take(RE.isoDate, (x) => +x[2] >= 1 && +x[2] <= 12 && +x[3] >= 1 && +x[3] <= 31))) {
      day = new Date(+m[1], +m[2] - 1, +m[3]);
    } else if ((m = take(RE.dotDate, (x) => +x[2] >= 1 && +x[2] <= 12 && +x[1] >= 1 && +x[1] <= 31))) {
      day = new Date(m[3] ? +m[3] : today.getFullYear(), +m[2] - 1, +m[1]);
      if (!m[3] && day < today) day.setFullYear(day.getFullYear() + 1); // "16.01." in December → next year
    } else {
      const nextWeek = !!take(RE.nextWeek);
      const wd = take(RE.weekday);
      const todayIdx = (today.getDay() + 6) % 7; // Monday = 0
      if (wd) {
        const target = WEEKDAYS[wd[1]];
        if (nextWeek) day = plusDays(today, 7 - todayIdx + target); // that weekday in next week
        else day = plusDays(today, ((target - todayIdx + 6) % 7) + 1); // next occurrence, never today
      } else if (nextWeek) {
        day = plusDays(today, 7);
      }
    }
  }

  // 3. Time of day.
  if (!exact) {
    const validTime = (h: number, min: number) => h >= 0 && h <= 23 && min >= 0 && min <= 59;
    if ((m = take(RE.prefixedTime, (x) => validTime(to24h(+x[1], x[3]), +(x[2] ?? 0))))) {
      time = [to24h(+m[1], m[3]), +(m[2] ?? 0)];
    } else if ((m = take(RE.clock, (x) => validTime(+x[1], +x[2])))) {
      time = [+m[1], +m[2]];
    } else if ((m = take(RE.ampm, (x) => +x[1] >= 1 && +x[1] <= 12))) {
      time = [to24h(+m[1], m[2]), 0];
    }
  }

  // 4. Combine into one moment.
  const hasDate = !!exact || !!day;
  const hasTime = !!exact || !!time;
  let datetime: Date;
  if (exact) {
    datetime = exact;
  } else if (!day && opts.baseDate) {
    // Calendar: the clicked day (and slot time unless the text gives one).
    const base = opts.baseDate;
    datetime = time
      ? atTime(base, time[0], time[1])
      : opts.baseHasTime
        ? new Date(base)
        : atTime(base, defH, defM);
  } else if (day && time) {
    datetime = atTime(day, time[0], time[1]);
  } else if (day) {
    datetime = atTime(day, defH, defM);
    // "today" without a time after the default time has passed → in about an hour.
    if (datetime <= now) datetime = roundUp5(new Date(now.getTime() + 3_600_000));
  } else if (time) {
    datetime = atTime(today, time[0], time[1]);
    if (datetime <= now) datetime = plusDays(datetime, 1); // that time has passed → tomorrow
  } else {
    datetime = atTime(plusDays(today, 1), defH, defM); // nothing given → tomorrow, default time
  }

  // 5. Title = original text minus the recognised pieces.
  let title = "";
  for (let i = 0; i < input.length; i++) title += removed[i] ? " " : input[i];
  title = title
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s,.;:–-]+|[\s,;:–-]+$/g, "")
    .trim();

  return { title, datetime, hasDate, hasTime, matches: matchContacts(work, opts.contacts ?? []) };
}

function roundUp5(d: Date): Date {
  const ms = 5 * 60_000;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}

/** Diacritic- and case-insensitive substring search: "berzins" finds "Bērziņš". */
export function searchMatch(haystack: string, query: string): boolean {
  return fold(haystack).includes(fold(query.trim()));
}
