<!-- Activity log: chronological feed of everything, filterable by contact, type and date range. -->
<script lang="ts">
  import { contactById, data, deleteActivity, updateActivity } from "../db/store.svelte";
  import { ACTIVITY_TYPES, type ActivityType } from "../db/types";
  import { fmtDate, fmtTime, t, tList } from "../i18n/index.svelte";
  import { toDateKey } from "../i18n/format";
  import { searchMatch } from "../quickadd/parser";
  import { openContact, ui } from "../ui/state.svelte";
  import InlineEdit from "../ui/InlineEdit.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import Icon from "../ui/Icon.svelte";
  import QuickReminders from "../reminders/QuickReminders.svelte";

  let contactId = $state("");
  let type = $state<ActivityType | "">("");
  let from = $state("");
  let to = $state("");
  let query = $state("");
  let searchInput: HTMLInputElement | undefined = $state();

  const contacts = $derived([...data.contacts].sort((a, b) => a.name.localeCompare(b.name, "lv")));
  const filtered = $derived(
    data.activities
      .filter((a) => {
        const day = toDateKey(a.timestamp);
        return (!contactId || a.contact_id === contactId) && (!type || a.type === type)
          && (!from || day >= from) && (!to || day <= to) && (!query.trim() || searchMatch(a.text, query));
      })
      .sort((a, b) => b.timestamp - a.timestamp),
  );
  /** Feed grouped under day headings. */
  const groups = $derived.by(() => {
    const out: { key: string; ts: number; items: typeof filtered }[] = [];
    for (const a of filtered) {
      const key = toDateKey(a.timestamp);
      if (out.at(-1)?.key !== key) out.push({ key, ts: a.timestamp, items: [] });
      out.at(-1)!.items.push(a);
    }
    return out;
  });
  const anyFilter = $derived(!!(contactId || type || from || to || query));

  $effect(() => {
    if (ui.focusSearch) { searchInput?.focus(); searchInput?.select(); }
  });

  function clear() { contactId = ""; type = ""; from = ""; to = ""; query = ""; }
  const weekday = (ts: number) => tList("date.weekdays_long")[(new Date(ts).getDay() + 6) % 7] ?? "";
</script>

<div class="page">
  <header class="row">
    <h1>{t("nav.activities")}</h1>
    <span class="muted">{filtered.length}</span>
    <label class="search field row">
      <Icon name="search" size={12} />
      <input bind:this={searchInput} bind:value={query} placeholder={t("activities.search_placeholder")} aria-label={t("common.search")} spellcheck="false"
        onkeydown={(e) => { if (e.key === "Escape") { query = ""; e.currentTarget.blur(); } }} />
    </label>
    <select class="field" bind:value={contactId} aria-label={t("activities.contact")}>
      <option value="">{t("activities.all_contacts")}</option>
      {#each contacts as c}<option value={c.id}>{c.name}</option>{/each}
    </select>
    <div class="row" style="gap:4px">
      <button class="btn small" class:on={!type} onclick={() => (type = "")}>{t("common.all")}</button>
      {#each ACTIVITY_TYPES as x}
        <button class="btn small" class:on={type === x} onclick={() => (type = type === x ? "" : x)}><Icon name={x} size={12} /> {t(`type.${x}`)}</button>
      {/each}
    </div>
    <label class="row muted" style="gap:4px">{t("activities.from")} <input class="field" type="date" bind:value={from} /></label>
    <label class="row muted" style="gap:4px">{t("activities.to")} <input class="field" type="date" bind:value={to} /></label>
    {#if anyFilter}<button class="btn small ghost" onclick={clear}>{t("contacts.clear_filters")}</button>{/if}
  </header>

  <div class="feed">
    {#if !data.activities.length}
      <EmptyState hint={t("activities.empty")} action={t("nav.contacts")} onaction={() => (ui.view = "contacts")} />
    {:else if !filtered.length}
      <EmptyState hint={t("activities.no_results")} action={t("contacts.clear_filters")} onaction={clear} />
    {/if}
    {#each groups as g (g.key)}
      <h2>{weekday(g.ts)}, {fmtDate(g.ts)}</h2>
      {#each g.items as a (a.id)}
        {@const c = contactById(a.contact_id)}
        <div class="item">
          <span class="time muted">{fmtTime(a.timestamp)}</span>
          <span class="muted" title={t(`type.${a.type}`)}><Icon name={a.type} /></span>
          <button class="link truncate who" onclick={() => openContact(a.contact_id)}>{c?.name ?? "—"}</button>
          <div class="grow"><InlineEdit value={a.text} onsave={(v) => updateActivity(a.id, { text: v })} label={t(`type.${a.type}`)} /></div>
          <span class="hover-actions row" style="gap:4px">
            <QuickReminders small title={t("reminder.followup", { name: c?.name ?? "" })} contactId={a.contact_id} />
            <button class="btn small ghost icon" title={t("common.delete")} aria-label={t("common.delete")} onclick={() => deleteActivity(a.id)}><Icon name="trash" size={12} /></button>
          </span>
        </div>
      {/each}
    {/each}
  </div>
</div>

<style>
  .page { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  header { padding: 14px 18px 10px; gap: 10px; flex-wrap: wrap; border-bottom: 0.5px solid var(--border); }
  .search { width: 200px; gap: 6px; color: var(--text-2); }
  .search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); }
  .feed { flex: 1; overflow-y: auto; padding: 4px 18px 40px; }
  h2 { padding: 14px 0 4px; }
  .item { display: flex; align-items: center; gap: 10px; min-height: 28px; padding: 0 8px; margin: 0 -8px; border-radius: 6px; }
  .item:hover { background: var(--bg-hover); }
  .time { width: 38px; flex: none; font-variant-numeric: tabular-nums; font-size: 12px; }
  .who { flex: none; width: 150px; font-weight: 500; }
</style>
