<!--
  Quick-add field with live preview. Used in three places: the Cmd+K overlay,
  the floating global-hotkey window and the menu bar dropdown.
  Type e.g. "Zvanīt Jānim rīt 10:00 par rēķinu" and press Enter.
-->
<script lang="ts">
  import { createReminder, data } from "../db/store.svelte";
  import { fmtDateTime, fmtWhen, t } from "../i18n/index.svelte";
  import { parseQuickAdd } from "./parser";
  import Icon from "../ui/Icon.svelte";

  interface Props {
    /** Called after Enter (created) or Esc. */
    onclose?: (created: boolean) => void;
    /** Smaller variant for the tray dropdown. */
    compact?: boolean;
  }
  let { onclose, compact = false }: Props = $props();

  let text = $state("");
  /** Index into the candidate list; candidates.length means "no contact". */
  let picked = $state(0);
  let input: HTMLInputElement | undefined = $state();

  const parsed = $derived(
    text.trim()
      ? parseQuickAdd(text, { now: new Date(), defaultTime: data.settings.tomorrow_time, contacts: data.contacts })
      : null,
  );
  const candidates = $derived(parsed?.matches ?? []);
  const contact = $derived(candidates[Math.min(picked, candidates.length)] ?? null);

  // A different set of candidates → start again from the best match.
  let lastKey = "";
  $effect(() => {
    const key = candidates.map((c) => c.id).join(",");
    if (key !== lastKey) { lastKey = key; picked = 0; }
  });

  // The overlay / floating window should be ready to type into immediately.
  $effect(() => {
    if (!compact) input?.focus();
  });

  export function focus() {
    input?.focus();
    input?.select();
  }

  function submit() {
    if (!parsed || !parsed.title) return;
    createReminder({ title: parsed.title, datetime: parsed.datetime.getTime(), contact_id: contact?.id ?? null });
    text = "";
    onclose?.(true);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (text && compact) text = ""; else onclose?.(false); }
    else if (candidates.length > 1 && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Tab")) {
      // Cycle through the matching contacts (and "no contact" at the end).
      e.preventDefault();
      const n = candidates.length + 1;
      picked = (picked + (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey) ? n - 1 : 1)) % n;
    }
  }
</script>

<div class="qa" class:compact>
  <div class="inputrow">
    <span class="faint"><Icon name="bolt" size={compact ? 13 : 16} /></span>
    <!-- svelte-ignore a11y_autofocus -->
    <input bind:this={input} bind:value={text} {onkeydown} autofocus={!compact} placeholder={t("quickadd.placeholder")} aria-label={t("nav.quick_add")} autocomplete="off" spellcheck="false" />
  </div>
  {#if parsed}
    <div class="preview">
      <div class="row">
        <span class="faint"><Icon name="bell" size={12} /></span>
        <span class="grow truncate ptitle">{parsed.title || t("quickadd.no_title")}</span>
        <span class="when" title={fmtDateTime(parsed.datetime.getTime())}>{fmtWhen(parsed.datetime.getTime())}</span>
      </div>
      {#if candidates.length}
        <div class="row cands">
          <span class="faint"><Icon name="people" size={12} /></span>
          {#each candidates as c, i (c.id)}
            <button class="btn small" class:on={contact?.id === c.id} onclick={() => { picked = i; input?.focus(); }}>{c.name}</button>
          {/each}
          {#if candidates.length > 1}
            <button class="btn small" class:on={!contact} onclick={() => { picked = candidates.length; input?.focus(); }}>{t("quickadd.no_contact")}</button>
            <span class="faint hint">{t("quickadd.pick_hint")}</span>
          {/if}
        </div>
      {/if}
      {#if !compact}
        <div class="faint hint">{t("quickadd.enter_hint")}</div>
      {/if}
    </div>
  {:else if !compact}
    <div class="preview faint hint">{t("quickadd.examples")}</div>
  {/if}
</div>

<style>
  .qa { display: flex; flex-direction: column; }
  .inputrow { display: flex; align-items: center; gap: 10px; padding: 14px 16px; }
  .inputrow input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font-size: 17px; }
  .inputrow input::placeholder { color: var(--text-3); }
  .preview { display: flex; flex-direction: column; gap: 7px; padding: 10px 16px 12px; border-top: 0.5px solid var(--border); }
  .ptitle { font-weight: 500; }
  .when { color: var(--accent); font-weight: 500; font-variant-numeric: tabular-nums; }
  .cands { flex-wrap: wrap; gap: 5px; }
  .hint { font-size: 11px; }
  .compact .inputrow { padding: 8px 10px; gap: 7px; }
  .compact .inputrow input { font-size: 13px; }
  .compact .preview { padding: 7px 10px 9px; }
</style>
