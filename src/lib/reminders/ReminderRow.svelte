<!-- One reminder line: one-click done checkbox, inline title, time, linked contact. -->
<script lang="ts">
  import type { Reminder } from "../db/types";
  import { contactById, deleteReminder, effectiveTime, setReminderDone, snoozeReminder, updateReminder } from "../db/store.svelte";
  import { exportReminderIcs } from "../db/backup";
  import { fmtWhen, t } from "../i18n/index.svelte";
  import { openContact, ui } from "../ui/state.svelte";
  import InlineEdit from "../ui/InlineEdit.svelte";
  import Icon from "../ui/Icon.svelte";

  interface Props {
    reminder: Reminder;
    showContact?: boolean;
    /** Called when the contact name is clicked (default: open it in the Contacts view). */
    onopencontact?: (id: string) => void;
    /** Tray dropdown: no hover actions, not editable. */
    compact?: boolean;
  }
  let { reminder: r, showContact = true, onopencontact, compact = false }: Props = $props();

  const contact = $derived(contactById(r.contact_id));
  const overdue = $derived(!r.done && effectiveTime(r) < ui.now);
</script>

<div class="rem" class:done={r.done}>
  <input type="checkbox" checked={r.done} title={t("reminder.mark_done")} aria-label={t("reminder.mark_done")}
    onchange={(e) => setReminderDone(r.id, e.currentTarget.checked)} />
  <div class="grow title">
    {#if compact}
      <span class="truncate">{r.title}</span>
    {:else}
      <InlineEdit value={r.title} onsave={(v) => updateReminder(r.id, { title: v })} label={t("reminder.title")} />
    {/if}
  </div>
  {#if r.repeat !== "none"}<span class="faint" title={t(`repeat.${r.repeat}`)}><Icon name="repeat" size={12} /></span>{/if}
  {#if showContact && contact}
    <button class="link truncate contact" onclick={() => (onopencontact ? onopencontact(contact.id) : openContact(contact.id))}>{contact.name}</button>
  {/if}
  {#if !compact}
    <span class="hover-actions row" style="gap:2px">
      {#if !r.done}
        <button class="btn small ghost" title={t("reminder.snooze_1h")} onclick={() => snoozeReminder(r.id, 60)}>+1h</button>
      {/if}
      <button class="btn small ghost icon" title={t("reminder.export_ics")} aria-label={t("reminder.export_ics")} onclick={() => exportReminderIcs(r)}><Icon name="export" size={12} /></button>
      <button class="btn small ghost icon" title={t("common.delete")} aria-label={t("common.delete")} onclick={() => deleteReminder(r.id)}><Icon name="trash" size={12} /></button>
    </span>
  {/if}
  <span class="when" class:red={overdue} class:muted={!overdue}>{fmtWhen(effectiveTime(r), ui.now)}</span>
</div>

<style>
  .rem { display: flex; align-items: center; gap: 8px; min-height: 26px; padding: 0 8px; border-radius: 6px; }
  .rem:hover { background: var(--bg-hover); }
  .title { display: flex; }
  .done .title { text-decoration: line-through; color: var(--text-3); }
  .contact { max-width: 150px; flex: none; }
  .when { flex: none; font-variant-numeric: tabular-nums; font-size: 12px; }
</style>
