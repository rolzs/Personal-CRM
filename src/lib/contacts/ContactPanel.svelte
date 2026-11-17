<!--
  Side panel for one contact: inline-editable details, quick reminder buttons,
  activity timeline (with quick "log activity" input), upcoming reminders, deals.
-->
<script lang="ts">
  import {
    createDeal, createReminder, data, deleteActivity, deleteContact, deleteDeal, effectiveTime, logActivity,
    updateActivity, updateContact, updateDeal,
  } from "../db/store.svelte";
  import { aiCall, aiErrorText, aiReady, aiResultLabel, type AiMeta } from "../ai/ai.svelte";
  import { contactContext, nextStepTime, todayLabel } from "../ai/prepare";
  import { fmtDate } from "../i18n/index.svelte";
  import { ACTIVITY_TYPES, STAGES, STATUSES, type ActivityType, type Contact, type Stage, type Status } from "../db/types";
  import { fmtDaysAgo, fmtMoney, fmtWhen, t } from "../i18n/index.svelte";
  import { toDateKey } from "../i18n/format";
  import { ui } from "../ui/state.svelte";
  import { freshness } from "./freshness";
  import InlineEdit from "../ui/InlineEdit.svelte";
  import Icon from "../ui/Icon.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import TagsEdit from "./TagsEdit.svelte";
  import QuickReminders from "../reminders/QuickReminders.svelte";
  import ReminderRow from "../reminders/ReminderRow.svelte";

  let { contact: c }: { contact: Contact } = $props();

  const activities = $derived(data.activities.filter((a) => a.contact_id === c.id).sort((a, b) => b.timestamp - a.timestamp));
  const reminders = $derived(data.reminders.filter((r) => r.contact_id === c.id && !r.done).sort((a, b) => effectiveTime(a) - effectiveTime(b)));
  const deals = $derived(data.deals.filter((d) => d.contact_id === c.id).sort((a, b) => b.created_at - a.created_at));
  const allTags = $derived([...new Set(data.contacts.flatMap((x) => x.tags))].sort());
  const followUp = $derived(t("reminder.followup", { name: c.name }));

  // Quick "log activity" input.
  let logType = $state<ActivityType>("call");
  let logText = $state("");
  let logInput: HTMLInputElement | undefined = $state();
  /** After logging: inline "Next step?" prompt with the quick reminder buttons (Esc dismisses). */
  const nextStep = $derived(ui.nextStepFor === c.id);

  function log() {
    const text = logText.trim();
    if (!text) return;
    logActivity(c.id, logType, text);
    logText = "";
    ui.nextStepFor = c.id;
    if (aiReady()) void suggestNextStep(`${logType}: ${text}`);
  }

  // ── Apple Intelligence ──────────────────────────────────────────────
  /** Contact summary card (not stored; gone when another contact is opened). */
  let summary = $state<(AiMeta & { summary: string; next_step: string }) | null>(null);
  let summarizing = $state(false);
  let summaryError = $state("");

  async function summarize() {
    summarizing = true;
    summaryError = "";
    try {
      summary = await aiCall("summarize", { context: contactContext(c, data.activities, data.reminders) });
    } catch (err) {
      summaryError = aiErrorText(err);
    } finally {
      summarizing = false;
    }
  }

  function addSummaryToNotes() {
    if (!summary) return;
    const block = `✨ ${fmtDate(Date.now())}: ${summary.summary}`;
    updateContact(c.id, { notes: c.notes.trim() ? `${c.notes.trim()}\n\n${block}` : block });
    summary = null;
  }

  /** AI follow-up suggestion shown in the "Next step?" prompt after logging an activity. */
  let suggestion = $state<{ title: string; at: number; meta: AiMeta } | null>(null);
  let suggesting = $state(false);
  let suggestSeq = 0;

  async function suggestNextStep(activity: string) {
    const seq = ++suggestSeq;
    suggestion = null;
    suggesting = true;
    try {
      const out = await aiCall<{ title: string; when: string }>("next_step", {
        context: contactContext(c, data.activities, data.reminders, 3000),
        activity,
        today: todayLabel(new Date()),
      });
      if (seq !== suggestSeq || !out.title) return;
      suggestion = { title: out.title, at: nextStepTime(out.when, data.settings.tomorrow_time, new Date()), meta: out };
    } catch (err) {
      console.warn("next-step suggestion failed", err);
    } finally {
      if (seq === suggestSeq) suggesting = false;
    }
  }

  function acceptSuggestion() {
    if (!suggestion) return;
    createReminder({ title: suggestion.title, datetime: suggestion.at, contact_id: c.id });
    suggestion = null;
    ui.nextStepFor = null;
  }

  export function focusLog() {
    logInput?.focus();
  }

  function onNameSaved(v: string) {
    updateContact(c.id, { name: v.trim() });
    ui.focusName = false;
  }

  function parseDue(value: string): number | null {
    if (!value) return null;
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d, 12).getTime();
  }
</script>

<aside class="panel">
  <div class="top">
    <div class="row">
      <div class="grow name"><InlineEdit value={c.name} onsave={onNameSaved} placeholder={t("contacts.name_placeholder")} label={t("contacts.name")} autoselect={ui.focusName} /></div>
      <button class="btn ghost icon" title={t("contacts.delete")} aria-label={t("contacts.delete")} onclick={() => { ui.selectedContactId = null; deleteContact(c.id); }}><Icon name="trash" /></button>
      <button class="btn ghost icon" title={t("common.close")} aria-label={t("common.close")} onclick={() => (ui.selectedContactId = null)}><Icon name="x" /></button>
    </div>
    <div class="row last">
      <span class="dot {freshness(c, ui.now)}"></span>
      <span class="muted" style="white-space:nowrap; flex:none">
        {c.last_contacted_at ? t("contacts.last_contacted", { ago: fmtDaysAgo(c.last_contacted_at, ui.now) }) : t("contacts.never_contacted")}
      </span>
      {#if reminders[0]}
        <span class="faint">·</span>
        <span class="muted truncate">{t("contacts.next_reminder")}: {fmtWhen(effectiveTime(reminders[0]), ui.now)}</span>
      {/if}
    </div>
    <div class="quickrow"><QuickReminders title={followUp} contactId={c.id} /></div>
    {#if aiReady()}
      <div class="row">
        <button class="btn small" disabled={summarizing} onclick={summarize}>✨ {summarizing ? t("ai.thinking") : t("ai.summary")}</button>
        {#if summaryError}<span class="red small">{summaryError}</span>{/if}
      </div>
    {/if}
  </div>

  {#if summary}
    <div class="aicard">
      <div class="row">
        <strong class="grow">✨ {t("ai.summary")}</strong>
        <button class="btn small ghost icon" title={t("common.close")} aria-label={t("common.close")} onclick={() => (summary = null)}><Icon name="x" size={11} /></button>
      </div>
      <p class="sum">{summary.summary}</p>
      {#if summary.next_step}
        <div class="nextai"><span class="muted">{t("contacts.next_step")}</span> {summary.next_step}</div>
        <QuickReminders small title={summary.next_step} contactId={c.id} />
      {/if}
      <div class="row foot">
        <span class="faint small grow">{aiResultLabel(summary)} · {t("ai.may_be_wrong")}</span>
        <button class="btn small" onclick={addSummaryToNotes}>{t("ai.add_to_notes")}</button>
      </div>
    </div>
  {/if}

  <div class="scroll">
    <dl class="fields">
      <dt>{t("contacts.company")}</dt>
      <dd><InlineEdit value={c.company} onsave={(v) => updateContact(c.id, { company: v })} placeholder="—" label={t("contacts.company")} /></dd>
      <dt>{t("contacts.email")}</dt>
      <dd><InlineEdit type="email" value={c.email} onsave={(v) => updateContact(c.id, { email: v.trim() })} placeholder="—" label={t("contacts.email")} /></dd>
      <dt>{t("contacts.phone")}</dt>
      <dd><InlineEdit type="tel" value={c.phone} onsave={(v) => updateContact(c.id, { phone: v.trim() })} placeholder="—" label={t("contacts.phone")} /></dd>
      <dt>{t("contacts.status")}</dt>
      <dd>
        <select class="inline sel" value={c.status} aria-label={t("contacts.status")} onchange={(e) => updateContact(c.id, { status: e.currentTarget.value as Status })}>
          {#each STATUSES as s}<option value={s}>{t(`status.${s}`)}</option>{/each}
        </select>
      </dd>
      <dt>{t("contacts.tags")}</dt>
      <dd><TagsEdit tags={c.tags} suggestions={allTags} onsave={(tags) => updateContact(c.id, { tags })} /></dd>
      <dt>{t("contacts.notes")}</dt>
      <dd><InlineEdit multiline value={c.notes} onsave={(v) => updateContact(c.id, { notes: v })} placeholder={t("contacts.notes_placeholder")} label={t("contacts.notes")} /></dd>
    </dl>

    <section>
      <h2>{t("contacts.reminders")}</h2>
      {#each reminders as r (r.id)}
        <ReminderRow reminder={r} showContact={false} />
      {:else}
        <div class="faint none">{t("contacts.no_reminders")}</div>
      {/each}
    </section>

    <section>
      <div class="row"><h2 class="grow">{t("contacts.deals")}</h2>
        <button class="btn small ghost" onclick={() => createDeal({ contact_id: c.id, title: t("deals.new_title") })}><Icon name="plus" size={11} /> {t("deals.add")}</button>
      </div>
      {#each deals as d (d.id)}
        <div class="deal">
          <div class="row">
            <div class="grow title"><InlineEdit value={d.title} onsave={(v) => updateDeal(d.id, { title: v })} placeholder={t("deals.title")} label={t("deals.title")} /></div>
            <div class="value"><InlineEdit type="number" value={d.value} onsave={(v) => updateDeal(d.id, { value: Number(v.replace(",", ".")) || 0 })} label={t("deals.value")} style="text-align:right" /></div>
            <span class="muted">€</span>
            <button class="btn small ghost icon hover-actions" title={t("common.delete")} aria-label={t("common.delete")} onclick={() => deleteDeal(d.id)}><Icon name="trash" size={12} /></button>
          </div>
          <div class="row meta">
            <select class="badge {d.stage} stage" value={d.stage} aria-label={t("deals.stage")} onchange={(e) => updateDeal(d.id, { stage: e.currentTarget.value as Stage })}>
              {#each STAGES as s}<option value={s}>{t(`stage.${s}`)}</option>{/each}
            </select>
            <span class="muted">{t("deals.due")}</span>
            <input class="inline due" type="date" value={d.due_date ? toDateKey(d.due_date) : ""} aria-label={t("deals.due")} onchange={(e) => updateDeal(d.id, { due_date: parseDue(e.currentTarget.value) })} />
            <span class="grow"></span>
            <span class="muted money">{fmtMoney(d.value)}</span>
          </div>
          <div class="dealnotes"><InlineEdit value={d.notes} onsave={(v) => updateDeal(d.id, { notes: v })} placeholder={t("deals.notes_placeholder")} label={t("contacts.notes")} /></div>
          <div><QuickReminders small title={d.title} contactId={c.id} dealId={d.id} /></div>
        </div>
      {:else}
        <div class="faint none">{t("contacts.no_deals")}</div>
      {/each}
    </section>

    <section>
      <h2>{t("contacts.timeline")}</h2>
      <div class="log">
        <div class="types" role="radiogroup" aria-label={t("activities.type")}>
          {#each ACTIVITY_TYPES as type}
            <button class="btn small" class:on={logType === type} role="radio" aria-checked={logType === type} title={t(`type.${type}`)} onclick={() => { logType = type; logInput?.focus(); }}>
              <Icon name={type} size={12} /> {t(`type.${type}`)}
            </button>
          {/each}
        </div>
        <input bind:this={logInput} class="field logtext" bind:value={logText} placeholder={t("contacts.log_placeholder")} aria-label={t("contacts.log_activity")}
          onkeydown={(e) => { if (e.key === "Enter") log(); else if (e.key === "Escape" && nextStep) { ui.nextStepFor = null; e.stopPropagation(); } }} />
      </div>

      {#if nextStep}
        <div class="next">
          <strong>{t("contacts.next_step")}</strong>
          <QuickReminders small title={followUp} contactId={c.id} oncreated={() => (ui.nextStepFor = null)} />
          {#if suggestion}
            <button class="btn small aichip" title={aiResultLabel(suggestion.meta)} onclick={acceptSuggestion}>✨ {suggestion.title} · {fmtWhen(suggestion.at, ui.now)}</button>
          {:else if suggesting}
            <span class="faint small">✨ {t("ai.thinking")}</span>
          {/if}
          <span class="grow"></span>
          <button class="btn small ghost" onclick={() => (ui.nextStepFor = null)}>{t("common.dismiss")} <span class="kbd">Esc</span></button>
        </div>
      {/if}

      {#each activities as a (a.id)}
        <div class="act">
          <span class="muted icon" title={t(`type.${a.type}`)}><Icon name={a.type} /></span>
          <div class="grow">
            <InlineEdit multiline value={a.text} onsave={(v) => updateActivity(a.id, { text: v })} label={t(`type.${a.type}`)} rows={1} />
            <div class="row meta">
              <span class="faint">{t(`type.${a.type}`)} · {fmtWhen(a.timestamp, ui.now)}</span>
              <span class="hover-actions row" style="gap:4px">
                <QuickReminders small title={followUp} contactId={c.id} />
                <button class="btn small ghost icon" title={t("common.delete")} aria-label={t("common.delete")} onclick={() => deleteActivity(a.id)}><Icon name="trash" size={12} /></button>
              </span>
            </div>
          </div>
        </div>
      {:else}
        <EmptyState hint={t("contacts.no_activity")} action={t("contacts.log_activity")} onaction={focusLog} />
      {/each}
    </section>
  </div>
</aside>

<style>
  .panel { width: 440px; flex: none; display: flex; flex-direction: column; border-left: 0.5px solid var(--border); background: var(--bg); min-height: 0; }
  .top { padding: 12px 16px 10px; border-bottom: 0.5px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
  .name :global(.inline) { font-size: 17px; font-weight: 600; }
  .last { font-size: 12px; }
  .scroll { flex: 1; overflow-y: auto; padding: 10px 16px 40px; display: flex; flex-direction: column; gap: 16px; }
  .fields { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 3px 8px; margin: 0; align-items: start; }
  dt { color: var(--text-2); padding-top: 3px; }
  dd { margin: 0; min-width: 0; }
  .sel { width: auto; appearance: none; -webkit-appearance: none; }
  section { display: flex; flex-direction: column; gap: 4px; }
  section > h2, section > .row > h2 { padding: 2px 0; }
  section :global(.rem) { margin: 0 -8px; }
  .none { padding: 2px 0; font-size: 12px; }
  .deal { padding: 6px 10px; border: 0.5px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; gap: 2px; }
  .deal .title :global(.inline) { font-weight: 500; }
  .value { width: 86px; flex: none; }
  .meta { font-size: 12px; gap: 6px; min-height: 22px; }
  .stage { border: 0; appearance: none; -webkit-appearance: none; cursor: pointer; }
  .due { width: 124px; font-size: 12px; margin: 0; }
  .dealnotes :global(.inline) { font-size: 12px; color: var(--text-2); }
  .money { font-variant-numeric: tabular-nums; }
  .log { display: flex; flex-direction: column; gap: 5px; margin-bottom: 4px; }
  .types { display: flex; gap: 4px; }
  .logtext { width: 100%; height: 28px; }
  .aicard { margin: 10px 16px 0; padding: 9px 12px; border-radius: 9px; background: var(--accent-soft); display: flex; flex-direction: column; gap: 5px; }
  .sum { margin: 0; line-height: 1.45; user-select: text; -webkit-user-select: text; }
  .nextai { font-size: 12px; }
  .foot { gap: 6px; }
  .small { font-size: 11px; }
  .aichip { border-color: var(--accent); color: var(--accent); max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .next { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 7px 10px; border-radius: 8px; background: var(--accent-soft); }
  .act { display: flex; gap: 8px; padding: 5px 0; border-bottom: 0.5px solid var(--border); }
  .act .icon { padding-top: 4px; }
</style>
