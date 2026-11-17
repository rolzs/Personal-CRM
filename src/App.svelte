<!-- Main window shell: sidebar, current view, overlays (quick add, cheat sheet, toasts) and shortcuts. -->
<script lang="ts">
  import { data, effectiveTime } from "./lib/db/store.svelte";
  import { newContact, smartUndo } from "./lib/bootstrap";
  import { t } from "./lib/i18n/index.svelte";
  import { isTauri } from "./lib/native";
  import { ui, VIEWS, type View } from "./lib/ui/state.svelte";
  import Icon from "./lib/ui/Icon.svelte";
  import Toasts from "./lib/ui/Toasts.svelte";
  import CheatSheet from "./lib/ui/CheatSheet.svelte";
  import QuickAdd from "./lib/quickadd/QuickAdd.svelte";
  import SummaryView from "./lib/summary/SummaryView.svelte";
  import ContactsView from "./lib/contacts/ContactsView.svelte";
  import CalendarView from "./lib/calendar/CalendarView.svelte";
  import ActivityView from "./lib/activities/ActivityView.svelte";
  import SettingsView from "./lib/settings/SettingsView.svelte";

  const ICONS: Record<View, string> = { summary: "home", contacts: "people", calendar: "calendar", activities: "list", settings: "gear" };
  const dueCount = $derived(data.reminders.filter((r) => !r.done && effectiveTime(r) < ui.now).length);

  function go(view: View) {
    ui.view = view;
  }

  function onkeydown(e: KeyboardEvent) {
    const el = e.target as HTMLElement;
    const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";

    if (e.key === "Escape") {
      if (ui.cheatOpen) { ui.cheatOpen = false; e.preventDefault(); }
      else if (ui.quickAddOpen) { ui.quickAddOpen = false; e.preventDefault(); }
      return;
    }
    if (e.key === "?" && !typing && !e.metaKey && !e.ctrlKey) {
      ui.cheatOpen = !ui.cheatOpen;
      e.preventDefault();
      return;
    }
    // In the app these come from the native menu bar (see src-tauri/src/menu.rs);
    // handling them here too would run every action twice.
    if (isTauri || !(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if (key >= "1" && key <= "4") go(VIEWS[+key - 1]);
    else if (key === "k") ui.quickAddOpen = true;
    else if (key === "n") newContact();
    else if (key === "f") { if (ui.view !== "activities") ui.view = "contacts"; ui.focusSearch++; }
    else if (key === ",") go("settings");
    else if (key === "z" && !typing) smartUndo(e.shiftKey);
    else return;
    e.preventDefault();
  }
</script>

<svelte:window {onkeydown} />

<div class="shell">
  <nav class="sidebar" aria-label="Personal CRM">
    {#each VIEWS as view, i}
      <button class="nav" class:on={ui.view === view} aria-current={ui.view === view ? "page" : undefined} onclick={() => go(view)}>
        <Icon name={ICONS[view]} size={15} />
        <span class="grow">{t(`nav.${view}`)}</span>
        {#if view === "summary" && dueCount}<span class="due">{dueCount}</span>{/if}
        <span class="hintkey">⌘{i + 1}</span>
      </button>
    {/each}
    <div class="grow"></div>
    <button class="nav" onclick={() => (ui.quickAddOpen = true)}><Icon name="bolt" size={15} /><span class="grow">{t("nav.quick_add")}</span><span class="hintkey">⌘K</span></button>
    <button class="nav" class:on={ui.view === "settings"} onclick={() => go("settings")}><Icon name="gear" size={15} /><span class="grow">{t("nav.settings")}</span><span class="hintkey">⌘,</span></button>
    <button class="nav" onclick={() => (ui.cheatOpen = true)}><span class="q">?</span><span class="grow">{t("shortcuts.title")}</span></button>
  </nav>

  <main>
    {#if !data.loaded}
      <!-- Data loads in a few milliseconds; nothing to show meanwhile. -->
    {:else if ui.view === "summary"}<SummaryView />
    {:else if ui.view === "contacts"}<ContactsView />
    {:else if ui.view === "calendar"}<CalendarView />
    {:else if ui.view === "activities"}<ActivityView />
    {:else}<SettingsView />{/if}
  </main>
</div>

{#if ui.quickAddOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={() => (ui.quickAddOpen = false)}>
    <div class="modal qa" role="dialog" aria-modal="true" aria-label={t("nav.quick_add")} tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <QuickAdd onclose={() => (ui.quickAddOpen = false)} />
    </div>
  </div>
{/if}
{#if ui.cheatOpen}<CheatSheet />{/if}
<Toasts />

<style>
  .shell { display: flex; height: 100%; }
  .sidebar { width: 196px; flex: none; display: flex; flex-direction: column; gap: 1px; padding: 12px 8px; background: var(--bg-side); border-right: 0.5px solid var(--border); }
  .nav { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; text-align: left; color: var(--text); }
  .nav:hover { background: var(--bg-hover); }
  .nav.on { background: var(--bg-active); font-weight: 500; }
  .hintkey { font-size: 11px; color: var(--text-3); }
  .due { min-width: 18px; height: 16px; padding: 0 5px; border-radius: 8px; background: var(--red); color: #fff; font-size: 11px; font-weight: 600; text-align: center; line-height: 16px; }
  .q { width: 15px; text-align: center; font-weight: 600; color: var(--text-2); }
  main { flex: 1; min-width: 0; min-height: 0; }
  .qa { width: 620px; overflow: hidden; }
</style>
