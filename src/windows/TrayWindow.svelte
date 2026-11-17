<!-- Menu bar dropdown: today's (and overdue) reminders with one-click done, plus a quick-add field. -->
<script lang="ts">
  import { onMount } from "svelte";
  import { data, effectiveTime, reload } from "../lib/db/store.svelte";
  import { t } from "../lib/i18n/index.svelte";
  import { dayDiff } from "../lib/i18n/format";
  import { emit, invoke, listen } from "../lib/native";
  import { ui } from "../lib/ui/state.svelte";
  import QuickAdd from "../lib/quickadd/QuickAdd.svelte";
  import ReminderRow from "../lib/reminders/ReminderRow.svelte";

  const pending = $derived(
    data.reminders
      .filter((r) => !r.done && dayDiff(ui.now, effectiveTime(r)) <= 0)
      .sort((a, b) => effectiveTime(a) - effectiveTime(b)),
  );
  const overdue = $derived(pending.filter((r) => effectiveTime(r) < ui.now));
  const today = $derived(pending.filter((r) => effectiveTime(r) >= ui.now));

  onMount(() => {
    const off = listen("window-shown", () => { ui.now = Date.now(); void reload(); });
    const offMenu = listen<string>("menu", (id) => { if (id === "undo" || id === "redo") document.execCommand(id); });
    const timer = setInterval(() => (ui.now = Date.now()), 30_000);
    return () => { clearInterval(timer); void off.then((f) => f()); void offMenu.then((f) => f()); };
  });

  const openMain = () => invoke("show_main_window");
  async function openContact(id: string) {
    await emit("open-contact", id);
    await openMain();
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === "Escape") void invoke("hide_current_window"); }} />

<div class="tray">
  <header class="row">
    <strong class="grow">{t("tray.today")}</strong>
    <span class="muted">{pending.length}</span>
    <button class="btn small" onclick={openMain}>{t("tray.open")}</button>
  </header>
  <div class="add card"><QuickAdd compact /></div>
  <div class="list">
    {#if overdue.length}
      <div class="sub red">{t("summary.overdue")}</div>
      {#each overdue as r (r.id)}<ReminderRow reminder={r} compact onopencontact={openContact} />{/each}
    {/if}
    {#if today.length}
      <div class="sub">{t("date.today")}</div>
      {#each today as r (r.id)}<ReminderRow reminder={r} compact onopencontact={openContact} />{/each}
    {/if}
    {#if data.loaded && !pending.length}<div class="none muted">{t("tray.empty")}</div>{/if}
  </div>
</div>

<style>
  .tray { height: 100%; display: flex; flex-direction: column; background: var(--bg-side); }
  header { padding: 10px 12px 8px; }
  .add { margin: 0 8px 6px; }
  .list { flex: 1; overflow-y: auto; padding: 0 4px 8px; }
  .sub { padding: 8px 8px 2px; font-size: 11px; font-weight: 600; color: var(--text-2); }
  .sub.red { color: var(--red); }
  .none { padding: 28px 12px; text-align: center; }
</style>
