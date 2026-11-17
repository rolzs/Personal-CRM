import { describe, expect, it } from "vitest";
import { reconcile, URL_PREFIX, type CalEvent, type Link, type SyncReminder } from "./reconcile";

const H = 3_600_000, MIN = 60_000;
const T0 = new Date(2026, 10, 20, 10, 0).getTime();
const W = { from: new Date(2026, 0, 1).getTime(), to: new Date(2028, 0, 1).getTime() };

const rem = (id: string, extra: Partial<SyncReminder> = {}): SyncReminder =>
  ({ id, title: `R ${id}`, datetime: T0, duration: null, done: false, notes: "", ...extra });
const ev = (id: string, rid: string | null, extra: Partial<CalEvent> = {}): CalEvent =>
  ({ event_id: id, url: rid ? URL_PREFIX + rid : null, title: `R ${rid}`, start: T0, end: T0 + 30 * MIN, all_day: false, ...extra });
const link = (rid: string, eid: string, extra: Partial<Link> = {}): Link =>
  ({ reminder_id: rid, event_id: eid, synced_title: `R ${rid}`, synced_start: T0, synced_end: T0 + 30 * MIN, ...extra });

const empty = { writes: [], deleteEvents: [], crmUpdates: [], crmDeletes: [], crmCreates: [], dropLinks: [] };

describe("Apple Calendar reconcile", () => {
  it("creates an event for a new pending reminder", () => {
    const p = reconcile([rem("a", { duration: 60, notes: "Jānis" })], [], [], W);
    expect(p.writes).toEqual([{ event_id: null, reminder_id: "a", title: "R a", notes: "Jānis", start: T0, end: T0 + H }]);
  });

  it("does nothing for done reminders or reminders outside the window", () => {
    const far = new Date(2030, 0, 1).getTime();
    const p = reconcile([rem("a", { done: true }), rem("b", { datetime: far })], [], [], W);
    expect(p).toMatchObject(empty);
  });

  it("our own write echoing back is a no-op", () => {
    const p = reconcile([rem("a")], [ev("e1", "a")], [link("a", "e1")], W);
    expect(p).toMatchObject(empty);
    expect(p.keepLinks).toEqual([link("a", "e1")]);
  });

  it("pushes a CRM edit to the event", () => {
    const p = reconcile([rem("a", { title: "Jauns", datetime: T0 + H })], [ev("e1", "a")], [link("a", "e1")], W);
    expect(p.writes).toEqual([{ event_id: "e1", reminder_id: "a", title: "Jauns", notes: "", start: T0 + H, end: T0 + H + 30 * MIN }]);
    expect(p.crmUpdates).toEqual([]);
  });

  it("applies a move made in Calendar to the reminder", () => {
    const moved = ev("e1", "a", { start: T0 + 24 * H, end: T0 + 24 * H + 30 * MIN });
    const p = reconcile([rem("a")], [moved], [link("a", "e1")], W);
    expect(p.crmUpdates).toEqual([{ id: "a", datetime: T0 + 24 * H }]);
    expect(p.writes).toEqual([]);
    expect(p.keepLinks[0]).toMatchObject({ synced_start: T0 + 24 * H });
  });

  it("applies a rename and a resize made in Calendar", () => {
    const changed = ev("e1", "a", { title: "Pārdēvēts", end: T0 + 90 * MIN });
    const p = reconcile([rem("a")], [changed], [link("a", "e1")], W);
    expect(p.crmUpdates).toEqual([{ id: "a", title: "Pārdēvēts", duration: 90 }]);
  });

  it("deletes the reminder when its event was deleted in Calendar", () => {
    const p = reconcile([rem("a")], [], [link("a", "e1")], W);
    expect(p.crmDeletes).toEqual(["a"]);
    expect(p.dropLinks).toEqual(["a"]);
  });

  it("deletes the event when the reminder is done or deleted in the CRM", () => {
    const p = reconcile([rem("a", { done: true })], [ev("e1", "a"), ev("e2", "b")], [link("a", "e1"), link("b", "e2")], W);
    expect(p.deleteEvents.sort()).toEqual(["e1", "e2"]);
    expect(p.dropLinks.sort()).toEqual(["a", "b"]);
    expect(p.crmDeletes).toEqual([]);
  });

  it("CRM wins when both sides changed", () => {
    const p = reconcile([rem("a", { title: "CRM" })], [ev("e1", "a", { title: "Calendar", start: T0 + H, end: T0 + H + 30 * MIN })], [link("a", "e1")], W);
    expect(p.writes).toMatchObject([{ event_id: "e1", title: "CRM", start: T0 }]);
    expect(p.crmUpdates).toEqual([]);
  });

  it("turns an event added in the CRM calendar into a reminder", () => {
    const p = reconcile([], [ev("e9", null, { title: "Zvans", end: T0 + H })], [], W);
    expect(p.crmCreates).toEqual([{ event_id: "e9", title: "Zvans", datetime: T0, duration: 60 }]);
  });

  it("all-day events added in Calendar get the default reminder time", () => {
    const day = new Date(2026, 10, 25).getTime();
    const p = reconcile([], [ev("e9", null, { title: "Visu dienu", start: day, end: day + 24 * H, all_day: true })], [], W, "08:30");
    expect(p.crmCreates).toEqual([{ event_id: "e9", title: "Visu dienu", datetime: new Date(2026, 10, 25, 8, 30).getTime(), duration: null }]);
  });

  it("re-adopts tagged events after the links were lost (e.g. restore)", () => {
    const p = reconcile([rem("a")], [ev("e1", "a")], [], W);
    expect(p.writes).toMatchObject([{ event_id: "e1", reminder_id: "a" }]);
    expect(p.crmCreates).toEqual([]);
  });

  it("removes orphaned tagged events whose reminder no longer exists", () => {
    const p = reconcile([], [ev("e1", "gone")], [], W);
    expect(p.deleteEvents).toEqual(["e1"]);
    expect(p.crmCreates).toEqual([]);
  });

  it("keeps links whose events are simply outside the window", () => {
    const far = new Date(2030, 0, 1).getTime();
    const l = link("a", "e1", { synced_start: far, synced_end: far + 30 * MIN });
    const p = reconcile([rem("a", { datetime: far })], [], [l], W);
    expect(p).toMatchObject(empty);
    expect(p.keepLinks).toEqual([l]);
  });
});
