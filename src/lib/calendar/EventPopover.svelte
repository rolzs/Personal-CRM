<!-- Click an event: mark done, edit, delete, export, or open the linked contact. -->
<script lang="ts">
  import { contactById, data, deleteReminder, setReminderDone, updateReminder } from "../db/store.svelte";
  import { exportReminderIcs } from "../db/backup";
  import { REPEATS, type Reminder, type Repeat } from "../db/types";
  import { t } from "../i18n/index.svelte";
  import { toInputValue } from "../i18n/format";
  import { openContact } from "../ui/state.svelte";
  import InlineEdit from "../ui/InlineEdit.svelte";
  import Icon from "../ui/Icon.svelte";

  interface Props { reminder: Reminder; x: number; y: number; onclose: () => void }
  let { reminder: r, x, y, onclose }: Props = $props();

  const W = 320, H = 250;
  const left = $derived(Math.max(8, Math.min(x, window.innerWidth - W - 8)));
  const top = $derived(Math.max(8, Math.min(y, window.innerHeight - H - 8)));
  const contact = $derived(contactById(r.contact_id));
  const sortedContacts = $derived([...data.contacts].sort((a, b) => a.name.localeCompare(b.name, "lv")));

  function setDatetime(value: string) {
    const ts = new Date(value).getTime();
    if (!Number.isNaN(ts)) updateReminder(r.id, { datetime: ts });
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="catch" onclick={onclose}></div>
<div class="modal pop" style="left:{left}px; top:{top}px; width:{W}px" role="dialog" aria-label={r.title}>
  <div class="row">
    <input type="checkbox" checked={r.done} title={t("reminder.mark_done")} aria-label={t("reminder.mark_done")} onchange={(e) => setReminderDone(r.id, e.currentTarget.checked)} />
    <div class="grow title" class:done={r.done}><InlineEdit value={r.title} onsave={(v) => updateReminder(r.id, { title: v })} label={t("reminder.title")} /></div>
    <button class="btn ghost icon" title={t("common.close")} aria-label={t("common.close")} onclick={onclose}><Icon name="x" /></button>
  </div>
  <dl>
    <dt>{t("reminder.when")}</dt>
    <dd><input class="inline" type="datetime-local" value={toInputValue(r.datetime)} aria-label={t("reminder.when")} onchange={(e) => setDatetime(e.currentTarget.value)} /></dd>
    <dt>{t("reminder.duration")}</dt>
    <dd class="row"><div style="width:60px"><InlineEdit type="number" value={r.duration} placeholder="—" label={t("reminder.duration")}
      onsave={(v) => updateReminder(r.id, { duration: Math.max(0, Math.round(Number(v))) || null })} /></div><span class="muted">{t("reminder.minutes")}</span></dd>
    <dt>{t("reminder.repeat")}</dt>
    <dd>
      <select class="inline" value={r.repeat} aria-label={t("reminder.repeat")} onchange={(e) => updateReminder(r.id, { repeat: e.currentTarget.value as Repeat })}>
        {#each REPEATS as x}<option value={x}>{t(`repeat.${x}`)}</option>{/each}
      </select>
    </dd>
    <dt>{t("reminder.contact")}</dt>
    <dd>
      <select class="inline" value={r.contact_id ?? ""} aria-label={t("reminder.contact")} onchange={(e) => updateReminder(r.id, { contact_id: e.currentTarget.value || null })}>
        <option value="">—</option>
        {#each sortedContacts as c}<option value={c.id}>{c.name}</option>{/each}
      </select>
    </dd>
  </dl>
  <div class="row actions">
    {#if contact}<button class="btn small" onclick={() => { onclose(); openContact(contact.id); }}><Icon name="people" size={12} /> {t("reminder.open_contact")}</button>{/if}
    <button class="btn small" onclick={() => exportReminderIcs(r)}><Icon name="export" size={12} /> {t("reminder.export_ics")}</button>
    <span class="grow"></span>
    <button class="btn small danger" onclick={() => { onclose(); deleteReminder(r.id); }}><Icon name="trash" size={12} /> {t("common.delete")}</button>
  </div>
</div>

<style>
  .catch { position: fixed; inset: 0; z-index: 40; }
  .pop { position: fixed; z-index: 41; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
  .title :global(.inline) { font-weight: 600; font-size: 14px; }
  .title.done :global(.inline) { text-decoration: line-through; color: var(--text-3); }
  dl { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 3px 8px; margin: 0; align-items: center; }
  dt { color: var(--text-2); }
  dd { margin: 0; min-width: 0; }
  select.inline { appearance: none; -webkit-appearance: none; }
  .actions { flex-wrap: wrap; gap: 6px; padding-top: 4px; }
</style>
