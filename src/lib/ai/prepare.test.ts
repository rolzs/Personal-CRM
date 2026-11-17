import { describe, expect, it } from "vitest";
import { contactContext, nextStepTime, todayLabel, validateExtracted, type PersonDraft } from "./prepare";
import type { Activity, Contact, Reminder } from "../db/types";

const NOW = new Date(2026, 10, 17, 12, 0); // Tuesday
const contact: Contact = {
  id: "c1", name: "Dmitrijs Boreiko", company: "Tilts", email: "", phone: "", tags: ["ieinteresēts"],
  status: "active", notes: "Head of Energy Department.\nCan generate excess energy.", created_at: 0, updated_at: 0,
  last_contacted_at: NOW.getTime() - 86_400_000, is_sample: 0,
};
const act = (i: number, text = `Call ${i}`): Activity =>
  ({ id: `a${i}`, contact_id: "c1", type: "call", text, timestamp: NOW.getTime() - i * 86_400_000, is_sample: 0 });

describe("contactContext", () => {
  it("includes details, newest activities first, open reminders and notes", () => {
    const rem: Reminder = { id: "r1", title: "Send offer", datetime: NOW.getTime() + 86_400_000, duration: null, contact_id: "c1",
      deal_id: null, done: false, done_at: null, repeat: "none", snoozed_until: null, created_at: 0, is_sample: 0 };
    const text = contactContext(contact, [act(3), act(1), { ...act(2), contact_id: "other" }], [rem]);
    expect(text).toContain("Name: Dmitrijs Boreiko");
    expect(text).toContain("Company: Tilts");
    expect(text.indexOf("Call 1")).toBeLessThan(text.indexOf("Call 3"));
    expect(text).not.toContain("Call 2");
    expect(text).toContain("Send offer");
    expect(text).toContain("Can generate excess energy.");
  });

  it("keeps at most 15 activities and caps the total size", () => {
    const many = Array.from({ length: 40 }, (_, i) => act(i + 1, "x".repeat(300)));
    const text = contactContext({ ...contact, notes: "n".repeat(10_000) }, many, []);
    expect(text.length).toBeLessThanOrEqual(6000);
    expect(text.match(/ call: /g)?.length).toBe(15);
  });
});

describe("nextStepTime", () => {
  it("understands the model's English phrases", () => {
    expect(nextStepTime("tomorrow 10:00", "09:00", NOW)).toBe(new Date(2026, 10, 18, 10, 0).getTime());
    expect(nextStepTime("in 3 days", "09:00", NOW)).toBe(new Date(2026, 10, 20, 9, 0).getTime());
    expect(nextStepTime("next week", "08:30", NOW)).toBe(new Date(2026, 10, 24, 8, 30).getTime());
    expect(nextStepTime("friday", "09:00", NOW)).toBe(new Date(2026, 10, 20, 9, 0).getTime());
  });
  it("falls back to tomorrow at the default time", () => {
    expect(nextStepTime("whenever suits", "09:00", NOW)).toBe(new Date(2026, 10, 18, 9, 0).getTime());
    expect(nextStepTime("", "09:00", NOW)).toBe(new Date(2026, 10, 18, 9, 0).getTime());
  });
  it("labels today for the model", () => {
    expect(todayLabel(NOW)).toBe("Tuesday, 17 November 2026");
  });
});

describe("validateExtracted", () => {
  const source = "Denis Litvinovs\nPurchasing Manager\nd.litvinovs@kekavafoods.lv\n+371 63960776\n\nRomāns Ivanovs\nr.ivanovs@kekavafoods.lv\n+371 2947 4526";
  const p = (x: Partial<PersonDraft>): PersonDraft => ({ name: "", title: "", company: "", email: "", phone: "", ...x });

  it("keeps details that are in the text (phones compared by digits)", () => {
    const out = validateExtracted([p({ name: "Denis Litvinovs", email: "d.litvinovs@kekavafoods.lv", phone: "+37163960776" })], source);
    expect(out).toEqual([p({ name: "Denis Litvinovs", email: "d.litvinovs@kekavafoods.lv", phone: "+37163960776" })]);
  });
  it("drops invented emails and phones", () => {
    const out = validateExtracted([p({ name: "Romāns Ivanovs", email: "romans@tilts.lv", phone: "+371 20000000" })], source);
    expect(out).toEqual([p({ name: "Romāns Ivanovs" })]);
  });
  it("drops companies taken from email domains or not in the text", () => {
    const out = validateExtracted([
      p({ name: "Denis Litvinovs", company: "kekavafoods.lv" }),
      p({ name: "Romāns Ivanovs", company: "Ķekava Foods" }),
    ], source);
    expect(out.map((x) => x.company)).toEqual(["", ""]);
    expect(validateExtracted([p({ name: "Denis Litvinovs", company: "SIA Tilts" })], `${source}\nSIA Tilts`)[0].company).toBe("SIA Tilts");
  });

  it("drops invented people, empty entries and duplicates", () => {
    const out = validateExtracted([
      p({ name: "Jānis Bērziņš" }),
      p({}),
      p({ name: "Denis Litvinovs", email: "d.litvinovs@kekavafoods.lv" }),
      p({ name: "Denis  Litvinovs", email: "D.Litvinovs@kekavafoods.lv" }),
    ], source);
    expect(out.map((x) => x.name)).toEqual(["Denis Litvinovs"]);
  });
});
