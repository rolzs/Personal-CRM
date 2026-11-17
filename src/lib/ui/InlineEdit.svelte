<!--
  Inline editing: looks like plain text, click to type, Enter or blur saves,
  Esc reverts. No Edit/Save buttons anywhere in the app.
-->
<script lang="ts">
  import { tick, untrack } from "svelte";

  interface Props {
    value: string | number | null;
    onsave: (value: string) => void;
    placeholder?: string;
    type?: "text" | "number" | "email" | "tel";
    multiline?: boolean;
    label?: string;
    /** Focus and select the text as soon as the field appears. */
    autoselect?: boolean;
    style?: string;
    /** Minimum visible lines of a multiline field. */
    rows?: number;
  }
  let { value, onsave, placeholder = "", type = "text", multiline = false, label = "", autoselect = false, style = "", rows = 2 }: Props = $props();

  const asText = (v: string | number | null) => (v === null || v === undefined ? "" : String(v));
  let draft = $state(untrack(() => asText(value)));
  let focused = $state(false);
  let el: HTMLInputElement | HTMLTextAreaElement | undefined = $state();

  // Follow outside changes (undo, another window) unless the user is typing.
  $effect(() => {
    const v = asText(value);
    if (!focused) draft = v;
  });

  $effect(() => {
    if (autoselect && el) tick().then(() => { el?.focus(); el?.select(); });
  });

  // Grow the textarea with its content.
  $effect(() => {
    if (multiline && el) {
      void draft;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 1}px`;
    }
  });

  function commit() {
    focused = false;
    if (draft !== asText(value)) onsave(draft);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && (!multiline || e.metaKey)) {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    } else if (e.key === "Escape") {
      draft = asText(value);
      e.stopPropagation();
      tick().then(() => el?.blur());
    }
  }
</script>

{#if multiline}
  <textarea bind:this={el} class="inline" {rows} bind:value={draft} {placeholder} aria-label={label} {style}
    onfocus={() => (focused = true)} onblur={commit} {onkeydown}></textarea>
{:else}
  <input bind:this={el} class="inline" {type} bind:value={draft} {placeholder} aria-label={label} {style}
    autocomplete="off" spellcheck="false" step="any"
    onfocus={() => (focused = true)} onblur={commit} {onkeydown} />
{/if}
