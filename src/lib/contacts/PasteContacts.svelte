<!--
  "Paste to contact": paste an email signature or any block of text, Apple
  Intelligence finds the people in it, you check/edit the rows and create them.
-->
<script lang="ts">
  import { createContact, tx } from "../db/store.svelte";
  import { t, tn } from "../i18n/index.svelte";
  import { aiCall, aiErrorText, aiResultLabel, type AiMeta } from "../ai/ai.svelte";
  import { validateExtracted, type PersonDraft } from "../ai/prepare";
  import { ui } from "../ui/state.svelte";
  import Icon from "../ui/Icon.svelte";

  let { onclose }: { onclose: () => void } = $props();

  type Row = PersonDraft & { use: boolean };
  let text = $state("");
  let rows = $state<Row[]>([]);
  let meta = $state<AiMeta | null>(null);
  let busy = $state(false);
  let error = $state("");
  let input: HTMLTextAreaElement | undefined = $state();

  $effect(() => { input?.focus(); });

  async function recognise() {
    const source = text.trim();
    if (!source || busy) return;
    busy = true;
    error = "";
    rows = [];
    try {
      const out = await aiCall<{ people: PersonDraft[] }>("extract_contacts", { text: source.slice(0, 6000) });
      meta = out;
      rows = validateExtracted(out.people ?? [], source).map((p) => ({ ...p, use: true }));
      if (!rows.length) error = t("ai.paste_none");
    } catch (err) {
      error = aiErrorText(err);
    } finally {
      busy = false;
    }
  }

  function create() {
    const chosen = rows.filter((r) => r.use && (r.name.trim() || r.email.trim() || r.phone.trim()));
    if (!chosen.length) return;
    let lastId = "";
    tx("contacts_pasted", () => {
      for (const r of chosen) {
        const c = createContact({
          name: r.name.trim() || r.email.trim() || r.phone.trim(),
          company: r.company.trim(),
          email: r.email.trim(),
          phone: r.phone.trim(),
          notes: r.title.trim() ? `${t("ai.job_title")}: ${r.title.trim()}` : "",
        });
        lastId = c.id;
      }
    }, true);
    ui.selectedContactId = chosen.length === 1 ? lastId : ui.selectedContactId;
    onclose();
  }

  const chosenCount = $derived(rows.filter((r) => r.use).length);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}>
  <div class="modal box" role="dialog" aria-modal="true" aria-label={t("ai.paste_title")} tabindex="-1" onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onclose(); } }}>
    <div class="row head">
      <h1 class="grow">✨ {t("ai.paste_title")}</h1>
      <button class="btn ghost icon" title={t("common.close")} aria-label={t("common.close")} onclick={onclose}><Icon name="x" /></button>
    </div>
    <textarea bind:this={input} class="field paste" bind:value={text} placeholder={t("ai.paste_placeholder")} aria-label={t("ai.paste_title")}
      onkeydown={(e) => { if (e.key === "Enter" && e.metaKey) { e.preventDefault(); recognise(); } }}></textarea>
    <div class="row">
      <button class="btn primary" disabled={busy || !text.trim()} onclick={recognise}>
        {busy ? t("ai.thinking") : t("ai.paste_recognise")} <span class="kbd light">⌘↩</span>
      </button>
      {#if meta && rows.length}<span class="faint small">{aiResultLabel(meta)} · {t("ai.may_be_wrong")}</span>{/if}
      {#if error}<span class="red small">{error}</span>{/if}
    </div>

    {#if rows.length}
      <div class="rows">
        <div class="r hdr faint">
          <span></span><span>{t("contacts.name")}</span><span>{t("ai.job_title")}</span><span>{t("contacts.company")}</span>
          <span>{t("contacts.email")}</span><span>{t("contacts.phone")}</span>
        </div>
        {#each rows as r, i (i)}
          <div class="r" class:off={!r.use}>
            <input type="checkbox" bind:checked={r.use} aria-label={r.name} />
            <input class="field" bind:value={r.name} aria-label={t("contacts.name")} />
            <input class="field" bind:value={r.title} aria-label={t("ai.job_title")} />
            <input class="field" bind:value={r.company} aria-label={t("contacts.company")} />
            <input class="field" bind:value={r.email} aria-label={t("contacts.email")} />
            <input class="field" bind:value={r.phone} aria-label={t("contacts.phone")} />
          </div>
        {/each}
      </div>
      <div class="row end">
        <button class="btn" onclick={onclose}>{t("common.close")}</button>
        <button class="btn primary" disabled={!chosenCount} onclick={create}>{tn("ai.paste_create", chosenCount)}</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .box { width: 860px; max-width: calc(100vw - 40px); padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
  .head h1 { font-size: 16px; }
  .paste { height: 150px; padding: 8px; resize: vertical; font-family: inherit; line-height: 1.4; }
  .small { font-size: 11px; }
  .rows { display: flex; flex-direction: column; gap: 4px; max-height: 40vh; overflow-y: auto; }
  .r { display: grid; grid-template-columns: 18px 1.2fr 1.1fr 1fr 1.4fr 1fr; gap: 6px; align-items: center; }
  .r .field { width: 100%; min-width: 0; }
  .r.off .field { opacity: 0.45; }
  .hdr { font-size: 11px; }
  .end { justify-content: flex-end; }
  .kbd.light { background: rgba(255, 255, 255, 0.2); border-color: transparent; color: #fff; }
</style>
