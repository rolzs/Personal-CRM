<!--
  One-click reminder buttons shown on every contact, activity and deal:
  +1h · Tomorrow 9:00 · +3 days · +1 week · Custom.
  A single click creates the reminder linked to that item.
-->
<script lang="ts">
  import { createReminder, data } from "../db/store.svelte";
  import { t } from "../i18n/index.svelte";
  import { toInputValue } from "../i18n/format";
  import { QUICK_KINDS, quickTime, type QuickKind } from "./quick";
  import Icon from "../ui/Icon.svelte";

  interface Props {
    title: string;
    contactId?: string | null;
    dealId?: string | null;
    /** Smaller buttons for hover rows. */
    small?: boolean;
    oncreated?: () => void;
  }
  let { title, contactId = null, dealId = null, small = false, oncreated }: Props = $props();

  let customOpen = $state(false);
  let customValue = $state("");

  function create(datetime: number) {
    createReminder({ title, datetime, contact_id: contactId, deal_id: dealId });
    customOpen = false;
    oncreated?.();
  }

  function label(kind: QuickKind): string {
    return kind === "tomorrow" ? t("quick.tomorrow", { time: data.settings.tomorrow_time.replace(/^0/, "") }) : t(`quick.${kind}`);
  }

  function openCustom() {
    customValue = toInputValue(quickTime("tomorrow", Date.now(), data.settings.tomorrow_time));
    customOpen = true;
  }

  function commitCustom() {
    const ts = new Date(customValue).getTime();
    if (!Number.isNaN(ts)) create(ts);
  }
</script>

<span class="quick" class:small>
  {#if !small}<span class="faint bell"><Icon name="bell" size={12} /></span>{/if}
  {#each QUICK_KINDS as kind}
    <button class="btn small" title={t("quick.title")} onclick={(e) => { e.stopPropagation(); create(quickTime(kind, Date.now(), data.settings.tomorrow_time)); }}>{label(kind)}</button>
  {/each}
  {#if customOpen}
    <!-- svelte-ignore a11y_autofocus -->
    <input class="field custom" type="datetime-local" bind:value={customValue} autofocus
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === "Enter") commitCustom(); if (e.key === "Escape") { e.stopPropagation(); customOpen = false; } }} />
    <button class="btn small primary" onclick={(e) => { e.stopPropagation(); commitCustom(); }}>{t("quick.set")}</button>
  {:else}
    <button class="btn small" onclick={(e) => { e.stopPropagation(); openCustom(); }}>{t("quick.custom")}</button>
  {/if}
</span>

<style>
  .quick { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  .bell { display: inline-flex; margin-right: 1px; }
  .custom { height: 20px; font-size: 11px; padding: 0 4px; }
</style>
