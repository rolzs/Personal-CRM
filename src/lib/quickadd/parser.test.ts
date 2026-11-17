import { describe, expect, it } from "vitest";
import { fold, matchContacts, matchesName, parseQuickAdd, searchMatch } from "./parser";
import { formatDate, formatDateTime, formatMoney, startOfWeek } from "../i18n/format";

// Monday, 16 November 2026, 08:30 local time.
const NOW = new Date(2026, 10, 16, 8, 30, 0, 0);
const CONTACTS = [
  { id: "1", name: "Jānis Bērziņš" },
  { id: "2", name: "Līga Ozoliņa" },
  { id: "3", name: "Andris Kalniņš" },
  { id: "4", name: "Ilze Liepiņa" },
  { id: "5", name: "Mārtiņš Krūmiņš" },
];
const parse = (text: string, contacts = CONTACTS) =>
  parseQuickAdd(text, { now: NOW, defaultTime: "09:00", contacts });
const at = (day: number, h: number, m = 0, month = 10) => new Date(2026, month, day, h, m, 0, 0);

describe("spec examples", () => {
  it("Zvanīt Jānim rīt 10:00 par rēķinu", () => {
    const r = parse("Zvanīt Jānim rīt 10:00 par rēķinu");
    expect(r.title).toBe("Zvanīt Jānim par rēķinu");
    expect(r.datetime).toEqual(at(17, 10));
    expect(r.hasDate).toBe(true);
    expect(r.hasTime).toBe(true);
    expect(r.matches.map((c) => c.name)).toEqual(["Jānis Bērziņš"]);
  });

  it("Call Janis tomorrow 10:00 re invoice", () => {
    const r = parse("Call Janis tomorrow 10:00 re invoice");
    expect(r.title).toBe("Call Janis re invoice");
    expect(r.datetime).toEqual(at(17, 10));
    expect(r.matches.map((c) => c.name)).toEqual(["Jānis Bērziņš"]);
  });
});

describe("Latvian dates", () => {
  it("šodien", () => {
    const r = parse("Nosūtīt piedāvājumu šodien");
    expect(r.title).toBe("Nosūtīt piedāvājumu");
    expect(r.datetime).toEqual(at(16, 9));
  });
  it("šodien after the default time has passed → about an hour from now", () => {
    const now = new Date(2026, 10, 16, 14, 2);
    const r = parseQuickAdd("Piezvanīt šodien", { now, defaultTime: "09:00" });
    expect(r.datetime).toEqual(at(16, 15, 5));
  });
  it("rīt", () => expect(parse("Tikšanās rīt").datetime).toEqual(at(17, 9)));
  it("parīt", () => {
    const r = parse("Tikšanās parīt 14:30");
    expect(r.title).toBe("Tikšanās");
    expect(r.datetime).toEqual(at(18, 14, 30));
  });
  it("nākamnedēļ", () => expect(parse("Atskaite nākamnedēļ").datetime).toEqual(at(23, 9)));
  it("nākamnedēļ + weekday", () => expect(parse("Atskaite nākamnedēļ trešdien").datetime).toEqual(at(25, 9)));

  it.each([
    ["pirmdien", 23], // today is Monday → next Monday
    ["otrdien", 17],
    ["trešdien", 18],
    ["ceturtdien", 19],
    ["piektdien", 20],
    ["sestdien", 21],
    ["svētdien", 22],
  ])("%s", (word, day) => {
    const r = parse(`Sapulce ${word} 11:00`);
    expect(r.title).toBe("Sapulce");
    expect(r.datetime).toEqual(at(day, 11));
  });

  it("pēc 3 dienām", () => {
    const r = parse("Pārbaudīt apmaksu pēc 3 dienām");
    expect(r.title).toBe("Pārbaudīt apmaksu");
    expect(r.datetime).toEqual(at(19, 9));
  });
  it("pēc stundas", () => {
    const r = parse("Atzvanīt pēc stundas");
    expect(r.title).toBe("Atzvanīt");
    expect(r.datetime).toEqual(at(16, 9, 30));
    expect(r.hasTime).toBe(true);
  });
  it("pēc 2 stundām", () => expect(parse("Atzvanīt pēc 2 stundām").datetime).toEqual(at(16, 10, 30)));
  it("plkst. 10", () => {
    const r = parse("Zvans plkst. 10");
    expect(r.title).toBe("Zvans");
    expect(r.datetime).toEqual(at(16, 10));
  });
  it("plkst. 8 already passed → tomorrow", () => expect(parse("Zvans plkst. 8").datetime).toEqual(at(17, 8)));
  it("10:00", () => expect(parse("Zvans 10:00").datetime).toEqual(at(16, 10)));
  it("16.11.2026 style dates", () => {
    expect(parse("Līgums 20.11.2026 15:00").datetime).toEqual(at(20, 15));
    expect(parse("Līgums 3.12. plkst. 9").datetime).toEqual(at(3, 9, 0, 11));
  });
  it("works without diacritics", () => {
    expect(parse("Zvanit Janim rit 10:00").datetime).toEqual(at(17, 10));
    expect(parse("sapulce tresdien").datetime).toEqual(at(18, 9));
  });
});

describe("English dates", () => {
  it("today", () => expect(parse("Send offer today").datetime).toEqual(at(16, 9)));
  it("tomorrow", () => expect(parse("Meeting tomorrow").datetime).toEqual(at(17, 9)));
  it("day after tomorrow", () => {
    const r = parse("Meeting day after tomorrow at 15");
    expect(r.title).toBe("Meeting");
    expect(r.datetime).toEqual(at(18, 15));
  });
  it("next week", () => expect(parse("Report next week").datetime).toEqual(at(23, 9)));
  it("next week friday", () => expect(parse("Report next week friday").datetime).toEqual(at(27, 9)));

  it.each([
    ["monday", 23],
    ["tuesday", 17],
    ["wednesday", 18],
    ["thursday", 19],
    ["friday", 20],
    ["saturday", 21],
    ["sunday", 22],
  ])("%s", (word, day) => {
    const r = parse(`Standup on ${word} 11:00`);
    expect(r.title).toBe("Standup");
    expect(r.datetime).toEqual(at(day, 11));
  });

  it("in 3 days", () => {
    const r = parse("Check payment in 3 days");
    expect(r.title).toBe("Check payment");
    expect(r.datetime).toEqual(at(19, 9));
  });
  it("in 1 hour", () => expect(parse("Call back in 1 hour").datetime).toEqual(at(16, 9, 30)));
  it("in an hour", () => expect(parse("Call back in an hour").datetime).toEqual(at(16, 9, 30)));
  it("at 10", () => {
    const r = parse("Call at 10");
    expect(r.title).toBe("Call");
    expect(r.datetime).toEqual(at(16, 10));
  });
  it("at 3pm", () => expect(parse("Call at 3pm").datetime).toEqual(at(16, 15)));
  it("10:00", () => expect(parse("Call 10:00").datetime).toEqual(at(16, 10)));
});

describe("defaults", () => {
  it("no date or time → tomorrow at the default time", () => {
    const r = parse("Nopirkt ziedus");
    expect(r.title).toBe("Nopirkt ziedus");
    expect(r.datetime).toEqual(at(17, 9));
    expect(r.hasDate).toBe(false);
    expect(r.hasTime).toBe(false);
  });
  it("respects the configured default time", () => {
    const r = parseQuickAdd("Tikšanās rīt", { now: NOW, defaultTime: "08:15" });
    expect(r.datetime).toEqual(at(17, 8, 15));
  });
  it("calendar: clicked day is used unless the text names one", () => {
    const base = new Date(2026, 10, 25);
    expect(parseQuickAdd("Demo 14:00", { now: NOW, baseDate: base }).datetime).toEqual(at(25, 14));
    expect(parseQuickAdd("Demo", { now: NOW, baseDate: base }).datetime).toEqual(at(25, 9));
    const slot = new Date(2026, 10, 25, 13, 30);
    expect(parseQuickAdd("Demo", { now: NOW, baseDate: slot, baseHasTime: true }).datetime).toEqual(slot);
  });
});

describe("contact matching with Latvian case endings", () => {
  it.each([
    ["Jānis", "Jānis"], ["Jāņa", "Jānis"], ["Jānim", "Jānis"], ["Jāni", "Jānis"], ["Janim", "Jānis"],
    ["Bērziņam", "Bērziņš"], ["Bērziņa", "Bērziņš"], ["berzinu", "Bērziņš"],
    ["Līgai", "Līga"], ["Līgas", "Līga"], ["Līgu", "Līga"],
    ["Ilzei", "Ilze"], ["Ilzes", "Ilze"], ["Ilzi", "Ilze"],
    ["Andrim", "Andris"], ["Andra", "Andris"],
    ["Mārtiņam", "Mārtiņš"], ["Mārtiņu", "Mārtiņš"],
    ["Mikum", "Mikus"], ["Kārļa", "Kārlis"], ["Gulbja", "Gulbis"],
  ])("%s → %s", (word, name) => expect(matchesName(word, name)).toBe(true));

  it("does not match unrelated words", () => {
    expect(matchesName("rīt", "Rita")).toBe(false);
    expect(matchesName("Jānītis", "Jānis")).toBe(false);
    expect(matchesName("par", "Pārsla")).toBe(false);
    expect(matchesName("zvanīt", "Jānis")).toBe(false);
  });

  it("links the genitive form: Jāņa → Jānis", () => {
    expect(parse("Apskatīt Jāņa piedāvājumu").matches.map((c) => c.id)).toEqual(["1"]);
  });
  it("matches by surname", () => {
    expect(parse("Nosūtīt rēķinu Kalniņam piektdien").matches.map((c) => c.id)).toEqual(["3"]);
  });
  it("returns several candidates for the picker", () => {
    const contacts = [...CONTACTS, { id: "6", name: "Jānis Ozols" }];
    const r = parse("Zvanīt Jānim rīt", contacts);
    expect(r.matches.map((c) => c.name)).toEqual(["Jānis Bērziņš", "Jānis Ozols"]);
  });
  it("first + last name narrows the candidates down", () => {
    const contacts = [...CONTACTS, { id: "6", name: "Jānis Ozols" }];
    expect(matchContacts("Zvanīt Jānim Ozolam", contacts).map((c) => c.id)).toEqual(["6"]);
  });
  it("no contact mentioned", () => expect(parse("Nopirkt ziedus rīt").matches).toEqual([]));
  it("date words are never mistaken for names", () => {
    expect(parse("Tikšanās rīt", [{ id: "9", name: "Rita Zeltiņa" }]).matches).toEqual([]);
  });
});

describe("diacritic-insensitive search", () => {
  it("fold", () => {
    expect(fold("Bērziņš")).toBe("berzins");
    expect(fold("ĀČĒĢĪĶĻŅŠŪŽ")).toBe("acegiklnsuz");
  });
  it("janis finds Jānis, berzins finds Bērziņš", () => {
    expect(searchMatch("Jānis Bērziņš", "janis")).toBe(true);
    expect(searchMatch("Jānis Bērziņš", "berzins")).toBe(true);
    expect(searchMatch("Jānis Bērziņš", "BĒRZ")).toBe(true);
    expect(searchMatch("Jānis Bērziņš", "ozols")).toBe(false);
  });
});

describe("locale formatting", () => {
  const ts = new Date(2026, 10, 16, 10, 0).getTime();
  it("Latvian", () => {
    expect(formatDateTime(ts, "lv")).toBe("16.11.2026 10:00");
    expect(formatMoney(1250, "lv")).toBe("1 250,00 €");
    expect(formatMoney(1234567.5, "lv")).toBe("1 234 567,50 €");
  });
  it("English per user setting", () => {
    expect(formatDate(ts, "en", "DD/MM/YYYY")).toBe("16/11/2026");
    expect(formatDate(ts, "en", "MM/DD/YYYY")).toBe("11/16/2026");
    expect(formatDate(ts, "en", "YYYY-MM-DD")).toBe("2026-11-16");
    expect(formatMoney(1250, "en")).toBe("€1,250.00");
  });
  it("weeks start on Monday", () => {
    expect(startOfWeek(new Date(2026, 10, 22, 15)).getDate()).toBe(16); // Sunday → Monday 16th
    expect(startOfWeek(new Date(2026, 10, 16, 0)).getDate()).toBe(16);
  });
});
