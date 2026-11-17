<!-- Floating quick-add window opened by the global hotkey (Ctrl+Option+Space) from any app. -->
<script lang="ts">
  import { onMount } from "svelte";
  import { data, flush, reload } from "../lib/db/store.svelte";
  import { invoke, listen } from "../lib/native";
  import QuickAdd from "../lib/quickadd/QuickAdd.svelte";

  let quickAdd: QuickAdd | undefined = $state();

  onMount(() => {
    // Shown again → pick up contacts changed elsewhere and focus the field.
    const off = listen("window-shown", () => { void reload(); quickAdd?.focus(); });
    const offMenu = listen<string>("menu", (id) => { if (id === "undo" || id === "redo") document.execCommand(id); });
    return () => { void off.then((f) => f()); void offMenu.then((f) => f()); };
  });

  async function close() {
    await flush(); // make sure the new reminder is on disk before the window hides
    await invoke("hide_current_window");
  }
</script>

<div class="win">
  {#if data.loaded}<QuickAdd bind:this={quickAdd} onclose={close} />{/if}
</div>

<style>
  .win { height: 100%; background: var(--bg-raised); }
</style>
