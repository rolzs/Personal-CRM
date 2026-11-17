<!-- Bottom-centre toasts; the newest one offers "Undo / Atsaukt". -->
<script lang="ts">
  import { ui, dismissToast } from "./state.svelte";
  import { undo } from "../db/store.svelte";
  import { t } from "../i18n/index.svelte";
</script>

<div class="toasts" aria-live="polite">
  {#each ui.toasts as toast (toast.id)}
    <div class="toast" class:error={toast.error}>
      <span class="truncate">{toast.text}</span>
      {#if toast.undoable}
        <button class="link" onclick={() => { dismissToast(toast.id); undo(); }}>{t("common.undo")}</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .toasts { position: fixed; left: 0; right: 0; bottom: 18px; z-index: 80; display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; }
  .toast {
    pointer-events: auto; display: flex; gap: 14px; align-items: center; max-width: 520px;
    padding: 7px 14px; border-radius: 9px; background: #2b2b2e; color: #fff; box-shadow: var(--shadow);
  }
  .toast.error { background: var(--red); }
  .toast :global(.link) { color: #7db4ff; font-weight: 500; }
</style>
