<!-- "?" – translated keyboard shortcut cheat sheet. -->
<script lang="ts">
  import { ui } from "./state.svelte";
  import { data } from "../db/store.svelte";
  import { t } from "../i18n/index.svelte";

  // Keys are fixed; descriptions come from the locale files.
  const GROUPS: { title: string; rows: [string[], string][] }[] = $derived([
    {
      title: "shortcuts.group_general",
      rows: [
        [["⌘", "K"], "shortcuts.quick_add"],
        [data.settings.hotkey.replace("Ctrl", "⌃").replace("Alt", "⌥").replace("Shift", "⇧").replace("Cmd", "⌘").split("+"), "shortcuts.global_quick_add"],
        [["⌘", "N"], "shortcuts.new_contact"],
        [["⌘", "F"], "shortcuts.search"],
        [["⌘", "Z"], "shortcuts.undo"],
        [["⇧", "⌘", "Z"], "shortcuts.redo"],
        [["⌘", ","], "shortcuts.settings"],
        [["?"], "shortcuts.cheatsheet"],
      ],
    },
    {
      title: "shortcuts.group_nav",
      rows: [
        [["⌘", "1"], "nav.summary"],
        [["⌘", "2"], "nav.contacts"],
        [["⌘", "3"], "nav.calendar"],
        [["⌘", "4"], "nav.activities"],
        [["⌘", "W"], "shortcuts.hide_window"],
        [["⌘", "Q"], "shortcuts.quit"],
      ],
    },
    {
      title: "shortcuts.group_editing",
      rows: [
        [["↩"], "shortcuts.save"],
        [["Esc"], "shortcuts.cancel"],
        [["↑", "↓"], "shortcuts.rows"],
        [["↩"], "shortcuts.open_row"],
      ],
    },
    {
      title: "shortcuts.group_calendar",
      rows: [
        [["←", "→"], "shortcuts.cal_prev_next"],
        [["T"], "shortcuts.cal_today"],
        [["M"], "shortcuts.cal_month"],
        [["W"], "shortcuts.cal_week"],
      ],
    },
  ]);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={() => (ui.cheatOpen = false)}>
  <div class="modal sheet" role="dialog" aria-modal="true" aria-label={t("shortcuts.title")} tabindex="-1" onclick={(e) => e.stopPropagation()}>
    <div class="row" style="justify-content:space-between; margin-bottom:12px">
      <h1>{t("shortcuts.title")}</h1>
      <button class="btn ghost" onclick={() => (ui.cheatOpen = false)}>{t("common.close")} <span class="kbd">Esc</span></button>
    </div>
    <div class="cols">
      {#each GROUPS as group}
        <section>
          <h2>{t(group.title)}</h2>
          {#each group.rows as [keys, label]}
            <div class="line">
              <span>{t(label)}</span>
              <span class="keys">{#each keys as k}<span class="kbd">{k}</span>{/each}</span>
            </div>
          {/each}
        </section>
      {/each}
    </div>
  </div>
</div>

<style>
  .sheet { width: 680px; padding: 20px 22px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 32px; }
  h2 { margin-bottom: 6px; }
  .line { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 0.5px solid var(--border); }
  .keys { display: flex; gap: 3px; }
</style>
