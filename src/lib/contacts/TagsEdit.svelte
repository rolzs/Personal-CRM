<!-- Tag chips with inline add (Enter or comma) and remove (× or Backspace). -->
<script lang="ts">
  import { t } from "../i18n/index.svelte";

  interface Props { tags: string[]; onsave: (tags: string[]) => void; suggestions?: string[] }
  let { tags, onsave, suggestions = [] }: Props = $props();
  let draft = $state("");
  const listId = `tags-${Math.random().toString(36).slice(2)}`;

  function add() {
    const tag = draft.trim().replace(/,$/, "").trim();
    draft = "";
    if (tag && !tags.includes(tag)) onsave([...tags, tag]);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
    else if (e.key === "Backspace" && !draft && tags.length) onsave(tags.slice(0, -1));
    else if (e.key === "Escape") { draft = ""; }
  }
</script>

<div class="tags">
  {#each tags as tag}
    <span class="tag">{tag}<button class="x" aria-label={t("common.delete")} onclick={() => onsave(tags.filter((x) => x !== tag))}>×</button></span>
  {/each}
  <input class="inline add" bind:value={draft} {onkeydown} onblur={add} placeholder={t("contacts.add_tag")} list={listId} aria-label={t("contacts.add_tag")} />
  <datalist id={listId}>{#each suggestions.filter((s) => !tags.includes(s)) as s}<option value={s}></option>{/each}</datalist>
</div>

<style>
  .tags { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  .x { border: 0; background: none; padding: 0; color: var(--text-3); line-height: 1; }
  .x:hover { color: var(--red); }
  .add { width: 90px; margin: 0; }
</style>
