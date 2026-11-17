<!--
  Home screen "Kopsavilkums": what needs attention right now.
  Overdue → today → next 7 days, untouched contacts, open deals, latest activity, status counts.
-->
<script lang="ts">
  import { clearSampleData, contactById, data, effectiveTime, hasSampleData } from "../db/store.svelte";
  import { STATUSES, type Reminder, type Stage } from "../db/types";
  import { fmtDaysAgo, fmtMoney, fmtWhen, t, tn } from "../i18n/index.svelte";
  import { dayDiff } from "../i18n/format";
  import { openContact, ui } from "../ui/state.svelte";
  import { daysUntouched } from "../contacts/freshness";
  import ReminderRow from "../reminders/ReminderRow.svelte";
  import QuickReminders from "../reminders/QuickReminders.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import Icon from "../ui/Icon.svelte";

  const byTime = (a: Reminder, b: Reminder) => effectiveTime(a) - effectiveTime(b);
  const pending = $derived(data.reminders.filter((r) => !r.done).sort(byTime));
  const overdue = $derived(pending.filter((r) => effectiveTime(r) < ui.now));
  const today = $derived(pending.filter((r) => effectiveTime(r) >= ui.now && dayDiff(ui.now, effectiveTime(r)) === 0));
  const week = $derived(pending.filter((r) => { const d = dayDiff(ui.now, effectiveTime(r)); return d >= 1 && d <= 7; }));
  const missed = $derived(ui.missed.map((id) => data.reminders.find((r) => r.id === id)).filter((r): r is Reminder => !!r));

  const untouched = $derived(
    data.contacts
      .filter((c) => c.status !== "closed" && daysUntouched(c, ui.now) >= data.settings.untouched_days)
      .sort((a, b) => daysUntouched(b, ui.now) - daysUntouched(a, ui.now)),
  );

  const OPEN_STAGES: Stage[] = ["new", "in_progress"];
  const dealStats = $derived(
    OPEN_STAGES.map((stage) => {
      const deals = data.deals.filter((d) => d.stage === stage);
      return { stage, count: deals.length, total: deals.reduce((sum, d) => sum + d.value, 0) };
    }),
  );
  const openTotal = $derived(dealStats.reduce((sum, s) => sum + s.total, 0));

  const recent = $derived([...data.activities].sort((a, b) => b.timestamp - a.timestamp).slice(0, 10));
  const statusCounts = $derived(STATUSES.map((s) => ({ status: s, count: data.contacts.filter((c) => c.status === s).length })));

  function showStatus(status: (typeof STATUSES)[number]) {
    ui.contactStatus = status;
    ui.selectedContactId = null;
    ui.view = "contacts";
  }
</script>

<div class="page">
  <header class="row">
    <h1 class="grow">{t("nav.summary")}</h1>
    <button class="btn" onclick={() => (ui.quickAddOpen = true)}><Icon name="bolt" size={12} /> {t("nav.quick_add")} <span class="kbd">⌘K</span></button>
  </header>

  {#if missed.length}
    <section class="card banner missed">
      <div class="row head">
        <h2 class="grow red">{t("summary.missed")}</h2>
        <button class="btn small ghost" onclick={() => (ui.missed = [])}>{t("common.dismiss")}</button>
      </div>
      {#each missed as r (r.id)}<ReminderRow reminder={r} />{/each}
    </section>
  {/if}

  {#if hasSampleData()}
    <section class="card banner row">
      <span class="grow muted">{t("summary.sample_hint")}</span>
      <button class="btn small" onclick={clearSampleData}>{t("settings.clear_sample")}</button>
    </section>
  {/if}

  <div class="stats">
    {#each statusCounts as s}
      <button class="card stat" onclick={() => showStatus(s.status)}>
        <span class="num">{s.count}</span>
        <span class="badge {s.status}">{t(`status.${s.status}`)}</span>
      </button>
    {/each}
  </div>

  <div class="grid">
    <div class="col">
      <section class="card">
        <div class="head"><h2>{t("summary.reminders")}</h2></div>
        {#if !overdue.length && !today.length && !week.length}
          <EmptyState hint={t("summary.no_reminders")} action={t("nav.quick_add")} onaction={() => (ui.quickAddOpen = true)} />
        {/if}
        {#if overdue.length}
          <div class="sub red">{t("summary.overdue")} · {overdue.length}</div>
          {#each overdue as r (r.id)}<ReminderRow reminder={r} />{/each}
        {/if}
        {#if today.length}
          <div class="sub">{t("date.today")} · {today.length}</div>
          {#each today as r (r.id)}<ReminderRow reminder={r} />{/each}
        {/if}
        {#if week.length}
          <div class="sub">{t("summary.next7")} · {week.length}</div>
          {#each week as r (r.id)}<ReminderRow reminder={r} />{/each}
        {/if}
      </section>

      <section class="card">
        <div class="head"><h2>{t("summary.recent")}</h2></div>
        {#each recent as a (a.id)}
          {@const c = contactById(a.contact_id)}
          <div class="line">
            <span class="muted" title={t(`type.${a.type}`)}><Icon name={a.type} /></span>
            <button class="link truncate who" onclick={() => openContact(a.contact_id)}>{c?.name ?? "—"}</button>
            <span class="grow truncate">{a.text}</span>
            <span class="hover-actions"><QuickReminders small title={t("reminder.followup", { name: c?.name ?? "" })} contactId={a.contact_id} /></span>
            <span class="muted when">{fmtWhen(a.timestamp, ui.now)}</span>
          </div>
        {:else}
          <EmptyState hint={t("summary.no_activity")} action={t("nav.contacts")} onaction={() => (ui.view = "contacts")} />
        {/each}
      </section>
    </div>

    <div class="col">
      <section class="card">
        <div class="head row"><h2 class="grow">{t("summary.open_deals")}</h2><strong>{fmtMoney(openTotal)}</strong></div>
        {#each dealStats as s}
          <div class="line">
            <span class="badge {s.stage}">{t(`stage.${s.stage}`)}</span>
            <span class="grow muted">{tn("summary.deals", s.count)}</span>
            <span class="money">{fmtMoney(s.total)}</span>
          </div>
        {/each}
      </section>

      <section class="card">
        <div class="head"><h2>{t("summary.untouched", { n: data.settings.untouched_days })}</h2></div>
        {#each untouched as c (c.id)}
          <div class="line">
            <span class="dot red"></span>
            <button class="link truncate who" onclick={() => openContact(c.id)}>{c.name}</button>
            <span class="grow truncate muted">{c.company}</span>
            <span class="hover-actions"><QuickReminders small title={t("reminder.followup", { name: c.name })} contactId={c.id} /></span>
            <span class="muted when">{c.last_contacted_at ? fmtDaysAgo(c.last_contacted_at, ui.now) : t("contacts.never")}</span>
          </div>
        {:else}
          <EmptyState hint={t("summary.none_untouched")} />
        {/each}
      </section>
    </div>
  </div>
</div>

<style>
  .page { height: 100%; overflow-y: auto; padding: 18px 22px 40px; display: flex; flex-direction: column; gap: 12px; }
  .grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 12px; align-items: start; }
  .col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  section.card { padding: 6px 4px 8px; }
  .head { padding: 6px 10px 4px; }
  .sub { padding: 8px 10px 2px; font-size: 11px; font-weight: 600; color: var(--text-2); }
  .sub.red { color: var(--red); }
  .banner { padding: 8px 12px; }
  .banner.missed { padding: 6px 4px 8px; border-color: var(--red); background: var(--red-soft); }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .stat { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; text-align: left; }
  .stat:hover { background: var(--bg-hover); }
  .num { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .line { display: flex; align-items: center; gap: 8px; min-height: 26px; padding: 0 10px; border-radius: 6px; }
  .line:hover { background: var(--bg-hover); }
  .who { flex: none; max-width: 160px; font-weight: 500; }
  .when { flex: none; font-size: 12px; font-variant-numeric: tabular-nums; }
  .money { font-variant-numeric: tabular-nums; font-weight: 500; }
</style>
