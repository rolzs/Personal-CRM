// One-click reminder presets: +1h, Tomorrow 9:00, +3 days, +1 week.

export type QuickKind = "h1" | "tomorrow" | "d3" | "w1";
export const QUICK_KINDS: QuickKind[] = ["h1", "tomorrow", "d3", "w1"];

/** `dayTime` is the "default reminder time" setting ("HH:MM"), used for the day-based presets. */
export function quickTime(kind: QuickKind, now: number, dayTime: string): number {
  if (kind === "h1") return now + 3_600_000;
  const [h, m] = dayTime.split(":").map(Number);
  const d = new Date(now);
  d.setDate(d.getDate() + (kind === "tomorrow" ? 1 : kind === "d3" ? 3 : 7));
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
}
