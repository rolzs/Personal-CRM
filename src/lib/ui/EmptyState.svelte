<!-- Empty state: one-line hint + a single action button. -->
<script lang="ts">
  interface Props { hint: string; action?: string; onaction?: () => void }
  let { hint, action, onaction }: Props = $props();
</script>

<div class="empty">
  <span class="muted">{hint}</span>
  {#if action && onaction}<button class="btn" onclick={onaction}>{action}</button>{/if}
</div>

<style>
  .empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 28px 16px; text-align: center; }
</style>
