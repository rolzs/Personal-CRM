<!--
  Contacts: table with instant diacritic-insensitive search, tag/status filters,
  sortable columns; clicking a row opens the side panel.
-->
<script lang="ts">
  import { createContact, data, effectiveTime, nextReminderFor } from "../db/store.svelte";
  import { STATUSES, type Contact } from "../db/types";
  import { fmtDaysAgo, fmtWhen, t } from "../i18n/index.svelte";
  import { fold } from "../quickadd/parser";
  import { ui } from "../ui/state.svelte";
  import { freshness } from "./freshness";
  import ContactPanel from "./ContactPanel.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import Icon from "../ui/Icon.svelte";

  type SortKey = "name" | "company" | "status" | "last" | "next";
  let query = $state("");
  let tag = $state("");
  let sortKey = $state<SortKey>("name");
  let sortDir = $state<1 | -1>(1);
  let searchInput: HTMLInputElement | undefined = $state();

  const allTags = $derived([...new Set(data.contacts.flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b)));

  // Pre-folded haystack per contact keeps typing instant even with thousands of rows.
  const indexed = $derived(
    data.contacts.map((c) => ({
      c,
      hay: fold([c.name, c.company, c.email, c.phone, c.tags.join(" ")].join(" ")),
      next: nextReminderFor(c.id),
    })),
  );

  const rows = $derived.by(() => {
    const q = fold(query.trim());
    const words = q ? q.split(/\s+/) : [];
    const list = indexed.filter(({ c, hay }) =>
      (!ui.contactStatus || c.status === ui.contactStatus) && (!tag || c.tags.includes(tag)) && words.every((w) => hay.includes(w)),
    );
    const cmpText = (a: string, b: string) => a.localeCompare(b, "lv");
    const cmpNum = (a: number | null | undefined, b: number | null | undefined) => {
      if (a == null && b == null) return 0;
      if (a == null) return 1; // empty values last
      if (b == null) return -1;
      return a - b;
    };
    return list.sort((x, y) => {
      let r = 0;
      if (sortKey === "name") r = cmpText(x.c.name, y.c.name);
      else if (sortKey === "company") r = cmpText(x.c.company, y.c.company);
      else if (sortKey === "status") r = STATUSES.indexOf(x.c.status) - STATUSES.indexOf(y.c.status);
      else if (sortKey === "last") r = cmpNum(x.c.last_contacted_at, y.c.last_contacted_at);
      else r = cmpNum(x.next && effectiveTime(x.next), y.next && effectiveTime(y.next));
      return r * sortDir || cmpText(x.c.name, y.c.name);
    });
  });

  const selected = $derived(data.contacts.find((c) => c.id === ui.selectedContactId));

  // Cmd+F
  $effect(() => {
    if (ui.focusSearch) { searchInput?.focus(); searchInput?.select(); }
  });

  function sortBy(key: SortKey) {
    if (sortKey === key) sortDir = sortDir === 1 ? -1 : 1;
    else { sortKey = key; sortDir = 1; }
  }

  function newContact() {
    query = ""; tag = ""; ui.contactStatus = "";
    const c = createContact({ name: t("contacts.new_name") });
    ui.focusName = true;
    ui.selectedContactId = c.id;
  }

  function move(delta: number) {
    if (!rows.length) return;
    const i = rows.findIndex((r) => r.c.id === ui.selectedContactId);
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + delta))] ?? rows[0];
    ui.selectedContactId = next.c.id;
    document.getElementById(`row-${next.c.id}`)?.scrollIntoView({ block: "nearest" });
  }

  function onkeydown(e: KeyboardEvent) {
    const el = e.target as HTMLElement;
    const inSearch = el === searchInput;
    const typing = !inSearch && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
    if (typing || e.metaKey || e.ctrlKey || e.altKey || ui.quickAddOpen || ui.cheatOpen) return;
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter" && inSearch) { if (!selected && rows[0]) ui.selectedContactId = rows[0].c.id; searchInput?.blur(); }
    else if (e.key === "Escape") {
      if (inSearch && query) query = "";
      else if (inSearch) searchInput?.blur();
      else if (ui.nextStepFor) ui.nextStepFor = null;
      else if (ui.selectedContactId) ui.selectedContactId = null;
    }
  }

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 1 ? " ↑" : " ↓") : "");
</script>

<svelte:window {onkeydown} />

<div class="wrap">
  <div class="main">
    <header class="row">
      <h1>{t("nav.contacts")}</h1>
      <span class="muted count">{rows.length}</span>
      <label class="search field row">
        <Icon name="search" size={12} />
        <input bind:this={searchInput} bind:value={query} placeholder={t("contacts.search_placeholder")} aria-label={t("common.search")} spellcheck="false" autocomplete="off" />
        <span class="kbd">⌘F</span>
      </label>
      <div class="row filters">
        <button class="btn small" class:on={!ui.contactStatus} onclick={() => (ui.contactStatus = "")}>{t("common.all")}</button>
        {#each STATUSES as s}
          <button class="btn small" class:on={ui.contactStatus === s} onclick={() => (ui.contactStatus = ui.contactStatus === s ? "" : s)}>{t(`status.${s}`)}</button>
        {/each}
        <select class="field tagsel" bind:value={tag} aria-label={t("contacts.tags")}>
          <option value="">{t("contacts.all_tags")}</option>
          {#each allTags as x}<option value={x}>{x}</option>{/each}
        </select>
      </div>
      <span class="grow"></span>
      <button class="btn primary" onclick={newContact}><Icon name="plus" size={12} /> {t("contacts.new")} <span class="kbd light">⌘N</span></button>
    </header>

    <div class="tablewrap">
      {#if !data.contacts.length}
        <EmptyState hint={t("contacts.empty")} action={t("contacts.new")} onaction={newContact} />
      {:else if !rows.length}
        <EmptyState hint={t("contacts.no_results")} action={t("contacts.clear_filters")} onaction={() => { query = ""; tag = ""; ui.contactStatus = ""; }} />
      {:else}
        <table>
          <thead>
            <tr>
              <th style="width:18%"><button onclick={() => sortBy("name")}>{t("contacts.name")}{arrow("name")}</button></th>
              <th style="width:20%"><button onclick={() => sortBy("company")}>{t("contacts.company")}{arrow("company")}</button></th>
              <th style="width:96px"><button onclick={() => sortBy("status")}>{t("contacts.status")}{arrow("status")}</button></th>
              <th>{t("contacts.tags")}</th>
              <th style="width:132px"><button onclick={() => sortBy("last")}>{t("contacts.last_contact")}{arrow("last")}</button></th>
              <th style="width:21%"><button onclick={() => sortBy("next")}>{t("contacts.next_reminder")}{arrow("next")}</button></th>
            </tr>
          </thead>
          <tbody>
            {#each rows as { c, next } (c.id)}
              <tr id="row-{c.id}" class:sel={c.id === ui.selectedContactId} onclick={() => { ui.focusName = false; ui.selectedContactId = c.id; }}>
                <td class="truncate name">{c.name || t("contacts.name_placeholder")}</td>
                <td class="truncate muted">{c.company}</td>
                <td><span class="badge {c.status}">{t(`status.${c.status}`)}</span></td>
                <td class="truncate">{#each c.tags as x}<span class="tag">{x}</span>{" "}{/each}</td>
                <td>
                  <span class="row" style="gap:6px"><span class="dot {freshness(c, ui.now)}"></span>
                    <span class="truncate">{c.last_contacted_at ? fmtDaysAgo(c.last_contacted_at, ui.now) : t("contacts.never")}</span></span>
                </td>
                <td class="truncate">
                  {#if next}<span class:red={effectiveTime(next) < ui.now}>{fmtWhen(effectiveTime(next), ui.now)}</span> <span class="muted">· {next.title}</span>{:else}<span class="faint">—</span>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </div>

  {#if selected}
    {#key selected.id}<ContactPanel contact={selected} />{/key}
  {/if}
</div>

<style>
  .wrap { display: flex; height: 100%; min-height: 0; }
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  header { padding: 14px 18px 10px; gap: 10px; flex-wrap: wrap; }
  .count { font-variant-numeric: tabular-nums; }
  .search { width: 230px; gap: 6px; color: var(--text-2); }
  .search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); }
  .filters { gap: 4px; }
  .tagsel { height: 20px; font-size: 11px; margin-left: 4px; max-width: 150px; }
  .kbd.light { background: rgba(255, 255, 255, 0.2); border-color: transparent; color: #fff; }
  .tablewrap { flex: 1; overflow: auto; border-top: 0.5px solid var(--border); }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th { position: sticky; top: 0; z-index: 1; background: var(--bg); text-align: left; font-weight: 500; font-size: 11px; color: var(--text-2); padding: 5px 10px; border-bottom: 0.5px solid var(--border); white-space: nowrap; }
  th:first-child, td:first-child { padding-left: 18px; }
  th button { border: 0; background: none; padding: 0; color: inherit; font-weight: inherit; }
  th button:hover { color: var(--text); }
  td { padding: 0 10px; height: 28px; border-bottom: 0.5px solid var(--border); max-width: 0; }
  tbody tr:hover { background: var(--bg-hover); }
  tbody tr.sel { background: var(--accent-soft); }
  .name { font-weight: 500; }
</style>
