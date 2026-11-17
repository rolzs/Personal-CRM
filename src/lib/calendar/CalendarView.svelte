<!--
  Calendar: month and week views built in-app (no calendar library).
  Click an empty day/slot → type → Enter creates an event. Drag to reschedule.
  Click an event for the popover. ←/→ navigate, T = today, M/W switch view.
-->
<script lang="ts">
  import { onMount, tick } from "svelte";
  import { createReminder, data, updateReminder } from "../db/store.svelte";
  import type { Reminder } from "../db/types";
  import { fmtDate, fmtTime, t, tList } from "../i18n/index.svelte";
  import { addDays, sameDay, startOfDay, startOfWeek, toDateKey } from "../i18n/format";
  import { parseQuickAdd } from "../quickadd/parser";
  import { ui } from "../ui/state.svelte";
  import Icon from "../ui/Icon.svelte";
  import EventPopover from "./EventPopover.svelte";

  const HOUR_PX = 44;
  const HOURS = Array.from({ length: 24 }, (_, h) => h);

  let mode = $state<"month" | "week">((localStorage.getItem("calendarMode") as "month" | "week") || "month");
  /** Any moment inside the displayed month / week. */
  let cursor = $state(startOfDay(Date.now()).getTime());
  /** Inline "new event" input: which day, and (week view) which minute of the day. */
  let draft = $state<{ day: number; minutes: number | null } | null>(null);
  let draftText = $state("");
  let popover = $state<{ id: string; x: number; y: number } | null>(null);
  let dragId: string | null = null;
  let dragOffsetY = 0;
  let weekScroll: HTMLDivElement | undefined = $state();

  $effect(() => localStorage.setItem("calendarMode", mode));

  // ── What is on screen ────────────────────────────────────────────────
  const monthStart = $derived(new Date(new Date(cursor).getFullYear(), new Date(cursor).getMonth(), 1));
  const days = $derived.by(() => {
    const first = mode === "month" ? startOfWeek(monthStart) : startOfWeek(cursor);
    return Array.from({ length: mode === "month" ? 42 : 7 }, (_, i) => addDays(first, i));
  });

  /** Reminders grouped by local day key, sorted by time. */
  const byDay = $derived.by(() => {
    const map = new Map<string, Reminder[]>();
    for (const r of data.reminders) {
      const key = toDateKey(r.datetime);
      const list = map.get(key);
      if (list) list.push(r); else map.set(key, [r]);
    }
    for (const list of map.values()) list.sort((a, b) => a.datetime - b.datetime);
    return map;
  });
  const eventsOn = (day: Date) => byDay.get(toDateKey(day)) ?? [];

  const title = $derived(
    mode === "month"
      ? `${tList("date.months")[monthStart.getMonth()]} ${monthStart.getFullYear()}`
      : `${fmtDate(days[0].getTime())} – ${fmtDate(days[6].getTime())}`,
  );
  const popReminder = $derived(popover ? data.reminders.find((r) => r.id === popover!.id) : undefined);

  // ── Navigation ───────────────────────────────────────────────────────
  function shift(dir: 1 | -1) {
    const d = new Date(cursor);
    if (mode === "month") { d.setDate(1); d.setMonth(d.getMonth() + dir); }
    else d.setDate(d.getDate() + 7 * dir);
    cursor = d.getTime();
  }
  const goToday = () => (cursor = startOfDay(Date.now()).getTime());

  function setMode(m: "month" | "week") {
    mode = m;
    if (m === "week") tick().then(scrollToMorning);
  }
  function scrollToMorning() {
    if (weekScroll) weekScroll.scrollTop = 7 * HOUR_PX - 8;
  }
  onMount(scrollToMorning);

  function onkeydown(e: KeyboardEvent) {
    const el = e.target as HTMLElement;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
    if (e.metaKey || e.ctrlKey || e.altKey || ui.quickAddOpen || ui.cheatOpen) return;
    if (e.key === "Escape" && popover) popover = null;
    else if (e.key === "ArrowLeft") shift(-1);
    else if (e.key === "ArrowRight") shift(1);
    else if (e.key === "t" || e.key === "T") goToday();
    else if (e.key === "m" || e.key === "M") setMode("month");
    else if (e.key === "w" || e.key === "W") setMode("week");
    else return;
    e.preventDefault();
  }

  // ── Create by clicking an empty day / slot ───────────────────────────
  function startDraft(day: Date, minutes: number | null) {
    commitDraft();
    draftText = "";
    draft = { day: day.getTime(), minutes };
  }

  function commitDraft() {
    const d = draft;
    const text = draftText.trim();
    draft = null;
    draftText = "";
    if (!d || !text) return;
    const base = new Date(d.day);
    if (d.minutes !== null) base.setHours(0, d.minutes, 0, 0);
    // The text may refine the time ("Demo 14:00") and mention a contact.
    const parsed = parseQuickAdd(text, {
      now: new Date(), defaultTime: data.settings.tomorrow_time, contacts: data.contacts,
      baseDate: base, baseHasTime: d.minutes !== null,
    });
    createReminder({
      title: parsed.title || text,
      datetime: parsed.datetime.getTime(),
      duration: d.minutes !== null ? 60 : null,
      contact_id: parsed.matches.length === 1 ? parsed.matches[0].id : null,
    });
  }

  function draftKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Enter") commitDraft();
    else if (e.key === "Escape") { draft = null; draftText = ""; }
  }

  function slotClick(e: MouseEvent, day: Date) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const minutes = Math.floor(((e.clientY - rect.top) / HOUR_PX) * 2) * 30; // snap to 30 min
    startDraft(day, Math.max(0, Math.min(23 * 60 + 30, minutes)));
  }

  // ── Drag to reschedule ───────────────────────────────────────────────
  function dragStart(e: DragEvent, r: Reminder) {
    dragId = r.id;
    // Where inside the event it was grabbed, so it does not jump on drop.
    dragOffsetY = e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top;
    e.dataTransfer?.setData("text/plain", r.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  /** Month view: keep the time, change the day. */
  function dropOnDay(e: DragEvent, day: Date) {
    e.preventDefault();
    const r = data.reminders.find((x) => x.id === dragId);
    dragId = null;
    if (!r) return;
    const old = new Date(r.datetime);
    const next = new Date(day);
    next.setHours(old.getHours(), old.getMinutes(), 0, 0);
    if (next.getTime() !== r.datetime) updateReminder(r.id, { datetime: next.getTime() });
  }

  /** Week view: day from the column, time from the drop position (15 min steps). */
  function dropOnSlot(e: DragEvent, day: Date) {
    e.preventDefault();
    const r = data.reminders.find((x) => x.id === dragId);
    dragId = null;
    if (!r) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const raw = ((e.clientY - rect.top - dragOffsetY) / HOUR_PX) * 60;
    const minutes = Math.max(0, Math.min(24 * 60 - 15, Math.round(raw / 15) * 15));
    const next = new Date(day);
    next.setHours(0, minutes, 0, 0);
    if (next.getTime() !== r.datetime) updateReminder(r.id, { datetime: next.getTime() });
  }

  function openPopover(e: MouseEvent, r: Reminder) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    popover = { id: r.id, x: rect.left, y: rect.bottom + 4 };
  }

  // ── Week layout: overlapping events share the column width ───────────
  function layout(events: Reminder[]) {
    const placed: { r: Reminder; top: number; height: number; col: number; cols: number }[] = [];
    let cluster: typeof placed = [];
    let clusterEnd = -1;
    const colEnds: number[] = [];
    const close = () => { for (const p of cluster) p.cols = colEnds.length; cluster = []; colEnds.length = 0; };
    for (const r of events) {
      const d = new Date(r.datetime);
      const start = d.getHours() * 60 + d.getMinutes();
      const end = start + Math.max(r.duration ?? 30, 30);
      if (start >= clusterEnd) close();
      let col = colEnds.findIndex((x) => x <= start);
      if (col < 0) col = colEnds.length;
      colEnds[col] = end;
      clusterEnd = Math.max(clusterEnd, end);
      const item = { r, top: (start / 60) * HOUR_PX, height: ((end - start) / 60) * HOUR_PX, col, cols: 1 };
      cluster.push(item);
      placed.push(item);
    }
    close();
    return placed;
  }

  const nowTop = $derived(((new Date(ui.now).getHours() * 60 + new Date(ui.now).getMinutes()) / 60) * HOUR_PX);
  const focusOnMount = (node: HTMLInputElement) => { node.focus(); };
</script>

<svelte:window {onkeydown} />

<div class="cal">
  <header class="row">
    <h1 class="title">{title}</h1>
    <button class="btn icon" title={t("calendar.prev")} aria-label={t("calendar.prev")} onclick={() => shift(-1)}><Icon name="left" size={12} /></button>
    <button class="btn" onclick={goToday}>{t("date.today")}</button>
    <button class="btn icon" title={t("calendar.next")} aria-label={t("calendar.next")} onclick={() => shift(1)}><Icon name="right" size={12} /></button>
    <span class="grow"></span>
    <span class="faint hint">{t("calendar.hint")}</span>
    <div class="row seg">
      <button class="btn" class:on={mode === "month"} onclick={() => setMode("month")}>{t("calendar.month")}</button>
      <button class="btn" class:on={mode === "week"} onclick={() => setMode("week")}>{t("calendar.week")}</button>
    </div>
  </header>

  {#if mode === "month"}
    <div class="weekdays">{#each tList("date.weekdays_short") as wd}<div>{wd}</div>{/each}</div>
    <div class="month">
      {#each days as day (day.getTime())}
        {@const events = eventsOn(day)}
        {@const isDraft = draft?.day === day.getTime()}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="cell" class:other={day.getMonth() !== monthStart.getMonth()} class:today={sameDay(day, ui.now)}
          onclick={() => startDraft(day, null)} ondragover={(e) => e.preventDefault()} ondrop={(e) => dropOnDay(e, day)}>
          <div class="num"><span>{day.getDate()}</span></div>
          {#each events.slice(0, isDraft ? 3 : 4) as r (r.id)}
            <button class="chip" class:done={r.done} class:past={!r.done && r.datetime < ui.now} draggable="true"
              ondragstart={(e) => dragStart(e, r)} onclick={(e) => openPopover(e, r)}>
              <span class="time">{fmtTime(r.datetime)}</span> {r.title}
            </button>
          {/each}
          {#if events.length > (isDraft ? 3 : 4)}
            <button class="more" onclick={(e) => { e.stopPropagation(); cursor = day.getTime(); setMode("week"); }}>+{events.length - (isDraft ? 3 : 4)}</button>
          {/if}
          {#if isDraft}
            <input class="field draft" bind:value={draftText} use:focusOnMount placeholder={t("calendar.new_placeholder")} aria-label={t("calendar.new_event")}
              onclick={(e) => e.stopPropagation()} onkeydown={draftKey} onblur={commitDraft} />
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="weekhead">
      <div class="gutter"></div>
      {#each days as day, i (day.getTime())}
        <div class="dayhead" class:today={sameDay(day, ui.now)}>{tList("date.weekdays_short")[i]} <span>{day.getDate()}</span></div>
      {/each}
    </div>
    <div class="weekscroll" bind:this={weekScroll}>
      <div class="week" style="height:{24 * HOUR_PX}px">
        <div class="gutter">{#each HOURS as h}<div class="hour" style="height:{HOUR_PX}px">{String(h).padStart(2, "0")}:00</div>{/each}</div>
        {#each days as day (day.getTime())}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <div class="daycol" class:today={sameDay(day, ui.now)} onclick={(e) => slotClick(e, day)}
            ondragover={(e) => e.preventDefault()} ondrop={(e) => dropOnSlot(e, day)}>
            {#each layout(eventsOn(day)) as p (p.r.id)}
              <button class="event" class:done={p.r.done} class:past={!p.r.done && p.r.datetime < ui.now} draggable="true"
                style="top:{p.top}px; height:{p.height - 1}px; left:calc({(p.col / p.cols) * 100}% + 1px); width:calc({100 / p.cols}% - 3px)"
                ondragstart={(e) => dragStart(e, p.r)} onclick={(e) => openPopover(e, p.r)}>
                <span class="time">{fmtTime(p.r.datetime)}</span> {p.r.title}
              </button>
            {/each}
            {#if sameDay(day, ui.now)}<div class="nowline" style="top:{nowTop}px"></div>{/if}
            {#if draft?.day === day.getTime() && draft.minutes !== null}
              <input class="field draft slot" style="top:{(draft.minutes / 60) * HOUR_PX}px" bind:value={draftText} use:focusOnMount
                placeholder={t("calendar.new_placeholder")} aria-label={t("calendar.new_event")}
                onclick={(e) => e.stopPropagation()} onkeydown={draftKey} onblur={commitDraft} />
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

{#if popover && popReminder}
  <EventPopover reminder={popReminder} x={popover.x} y={popover.y} onclose={() => (popover = null)} />
{/if}

<style>
  .cal { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  header { padding: 14px 18px 10px; gap: 6px; }
  .title { min-width: 250px; }
  .hint { font-size: 11px; margin-right: 10px; }
  .seg { gap: 0; }
  .seg .btn:first-child { border-radius: 6px 0 0 6px; }
  .seg .btn:last-child { border-radius: 0 6px 6px 0; margin-left: -0.5px; }

  .weekdays, .weekhead { display: grid; font-size: 11px; color: var(--text-2); border-bottom: 0.5px solid var(--border); }
  .weekdays { grid-template-columns: repeat(7, 1fr); }
  .weekdays div { padding: 3px 8px; text-align: right; }
  .month { flex: 1; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); grid-template-rows: repeat(6, minmax(0, 1fr)); min-height: 0; }
  .cell { border-right: 0.5px solid var(--border); border-bottom: 0.5px solid var(--border); padding: 2px 3px; display: flex; flex-direction: column; gap: 1px; min-height: 0; overflow: hidden; }
  .cell:nth-child(7n) { border-right: 0; }
  .cell:hover { background: var(--bg-hover); }
  .cell.other { color: var(--text-3); background: var(--bg-side); }
  .num { text-align: right; font-size: 12px; padding: 1px 3px; font-variant-numeric: tabular-nums; }
  .today .num span, .dayhead.today span { display: inline-block; min-width: 20px; padding: 0 5px; border-radius: 10px; background: var(--red); color: #fff; text-align: center; font-weight: 600; }
  .chip, .event { border: 0; text-align: left; font-size: 11px; line-height: 1.35; border-radius: 4px; background: var(--accent-soft); color: var(--accent); overflow: hidden; cursor: grab; }
  .chip { padding: 0 5px; white-space: nowrap; text-overflow: ellipsis; flex: none; }
  .chip:hover, .event:hover { filter: brightness(0.94) saturate(1.3); }
  .time { font-weight: 600; font-variant-numeric: tabular-nums; }
  .past { background: var(--red-soft); color: var(--red); }
  .done { background: var(--gray-soft); color: var(--text-3); text-decoration: line-through; }
  .more { border: 0; background: none; color: var(--text-2); font-size: 11px; text-align: left; padding: 0 5px; }
  .more:hover { color: var(--accent); }
  .draft { height: 20px; font-size: 11px; padding: 0 5px; width: 100%; flex: none; }

  .weekhead { grid-template-columns: 52px repeat(7, minmax(0, 1fr)); }
  .dayhead { padding: 4px 8px; text-align: right; border-left: 0.5px solid var(--border); }
  .weekscroll { flex: 1; overflow-y: auto; min-height: 0; }
  .week { display: grid; grid-template-columns: 52px repeat(7, minmax(0, 1fr)); position: relative; }
  .gutter .hour { font-size: 10px; color: var(--text-3); text-align: right; padding-right: 6px; transform: translateY(-6px); font-variant-numeric: tabular-nums; }
  .daycol { position: relative; border-left: 0.5px solid var(--border); background-image: linear-gradient(to bottom, var(--border) 0.5px, transparent 0.5px); background-size: 100% 44px; }
  .daycol.today { background-color: var(--accent-soft); }
  .event { position: absolute; padding: 1px 5px; }
  .nowline { position: absolute; left: 0; right: 0; height: 0; border-top: 1.5px solid var(--red); pointer-events: none; z-index: 2; }
  .slot { position: absolute; left: 2px; width: calc(100% - 4px); z-index: 3; }
</style>
