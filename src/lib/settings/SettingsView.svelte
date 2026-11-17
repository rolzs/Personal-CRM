<!-- Settings / Iestatījumi. Every change applies immediately; nothing to save. -->
<script lang="ts">
  import { clearSampleData, data, hasSampleData, setSetting } from "../db/store.svelte";
  import { backupFolder, backupNowWithToast, exportAllIcs, exportJson, importJson, restoreFromBackup } from "../db/backup";
  import { seedSampleData } from "../db/seed";
  import type { EnDateFormat, Lang } from "../db/types";
  import { fmtDateTime, fmtMoney, t } from "../i18n/index.svelte";
  import { invoke, isTauri, pickFolder } from "../native";
  import { acceleratorFromEvent, applyAutostart, applyDock, applyHotkey, applyLanguage } from "./apply";
  import { appleCal, disableAppleCalendar, enableAppleCalendar, openCalendarPrivacySettings, refreshCalendarStatus } from "../calendar/appleSync.svelte";
  import { fmtWhen } from "../i18n/index.svelte";
  import { ui } from "../ui/state.svelte";

  let folder = $state("");
  let dbPath = $state("");
  let recording = $state(false);

  $effect(() => {
    void data.settings.backup_dir;
    backupFolder().then((f) => (folder = f));
  });
  invoke<string>("db_path").then((p) => (dbPath = p ?? ""));
  void refreshCalendarStatus();

  let calendarToggling = $state(false);
  async function toggleCalendar(on: boolean) {
    calendarToggling = true;
    try {
      if (on) await enableAppleCalendar();
      else disableAppleCalendar();
    } finally {
      calendarToggling = false;
    }
  }

  function setLanguage(lang: Lang) {
    setSetting("language", lang);
    applyLanguage();
  }

  async function chooseFolder() {
    const picked = await pickFolder(folder);
    if (picked) setSetting("backup_dir", picked);
  }

  function recordHotkey(e: KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { recording = false; return; }
    const accel = acceleratorFromEvent(e);
    if (!accel) return;
    const previous = data.settings.hotkey;
    setSetting("hotkey", accel);
    recording = false;
    applyHotkey().then((ok) => { if (!ok) { setSetting("hotkey", previous); applyHotkey(); } });
  }

  const pretty = (accel: string) => accel.replace("Ctrl", "⌃").replace("Alt", "⌥").replace("Shift", "⇧").replace("Cmd", "⌘").replaceAll("+", " ");
  const sampleTs = new Date(2026, 10, 16, 10, 0).getTime();
</script>

<div class="page">
  <h1>{t("nav.settings")}</h1>

  <section class="card">
    <h2>{t("settings.general")}</h2>
    <div class="line">
      <span class="grow">{t("settings.language")}</span>
      <div class="row seg">
        <button class="btn" class:on={data.settings.language === "lv"} onclick={() => setLanguage("lv")}>Latviešu</button>
        <button class="btn" class:on={data.settings.language === "en"} onclick={() => setLanguage("en")}>English</button>
      </div>
    </div>
    {#if data.settings.language === "en"}
      <div class="line">
        <span class="grow">{t("settings.date_format")}</span>
        <select class="field" value={data.settings.en_date_format} onchange={(e) => setSetting("en_date_format", e.currentTarget.value as EnDateFormat)}>
          <option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option>
        </select>
      </div>
    {/if}
    <div class="line"><span class="grow muted">{t("settings.format_preview")}</span><span class="muted">{fmtDateTime(sampleTs)} · {fmtMoney(1250)}</span></div>
    <div class="line">
      <label class="grow" for="untouched">{t("settings.untouched_days")}</label>
      <input id="untouched" class="field num" type="number" min="1" max="999" value={data.settings.untouched_days}
        onchange={(e) => setSetting("untouched_days", Math.max(1, Math.round(Number(e.currentTarget.value)) || 30))} />
    </div>
    <div class="line">
      <label class="grow" for="tomorrow">{t("settings.tomorrow_time")}</label>
      <input id="tomorrow" class="field" type="time" value={data.settings.tomorrow_time}
        onchange={(e) => setSetting("tomorrow_time", e.currentTarget.value || "09:00")} />
    </div>
  </section>

  <section class="card">
    <h2>{t("settings.system")}</h2>
    <div class="line">
      <div class="grow"><div>{t("settings.hotkey")}</div><div class="faint small">{t("settings.hotkey_hint")}</div></div>
      <button class="btn hotkey" class:on={recording} onclick={() => (recording = true)} onkeydown={(e) => { if (recording) recordHotkey(e); }} onblur={() => (recording = false)}>
        {recording ? t("settings.hotkey_recording") : pretty(data.settings.hotkey)}
      </button>
    </div>
    <label class="line">
      <span class="grow">{t("settings.autostart")}</span>
      <input type="checkbox" checked={data.settings.autostart} onchange={(e) => { setSetting("autostart", e.currentTarget.checked); applyAutostart(); }} />
    </label>
    <label class="line">
      <div class="grow"><div>{t("settings.show_dock")}</div><div class="faint small">{t("settings.show_dock_hint")}</div></div>
      <input type="checkbox" checked={data.settings.show_dock} onchange={(e) => { setSetting("show_dock", e.currentTarget.checked); applyDock(); }} />
    </label>
  </section>

  <section class="card">
    <h2>{t("apple.title")}</h2>
    <label class="line">
      <div class="grow"><div>{t("apple.toggle")}</div><div class="faint small">{t("apple.hint")}</div></div>
      <input type="checkbox" checked={data.settings.calendar_sync} disabled={calendarToggling}
        onchange={(e) => toggleCalendar(e.currentTarget.checked)} />
    </label>
    {#if data.settings.calendar_sync}
      <div class="line">
        <span class="grow muted">{t("apple.synced", { n: appleCal.count })}</span>
        <span class="faint small">{appleCal.busy ? t("apple.syncing") : appleCal.lastSync ? t("apple.last_sync", { when: fmtWhen(appleCal.lastSync, ui.now) }) : ""}</span>
      </div>
    {:else if appleCal.status === "denied" || appleCal.status === "write_only"}
      <div class="line">
        <span class="grow muted small">{t(appleCal.status === "write_only" ? "apple.write_only" : "apple.denied")}</span>
        <button class="btn" onclick={openCalendarPrivacySettings}>{t("apple.open_settings")}</button>
      </div>
    {/if}
  </section>

  <section class="card">
    <h2>{t("settings.backup")}</h2>
    <div class="line">
      <div class="grow"><div>{t("settings.backup_folder")}</div><div class="faint small path">{folder || "~/Documents/CRM Backups"}</div></div>
      <button class="btn" onclick={chooseFolder}>{t("settings.choose")}</button>
    </div>
    <div class="line">
      <div class="grow"><div>{t("settings.auto_backup")}</div>
        <div class="faint small">{data.settings.last_auto_backup ? t("settings.last_backup", { date: data.settings.last_auto_backup }) : t("settings.no_backup_yet")}</div></div>
      <button class="btn" onclick={backupNowWithToast}>{t("settings.backup_now")}</button>
      <button class="btn" onclick={restoreFromBackup}>{t("settings.restore")}</button>
    </div>
    <div class="line">
      <span class="grow">{t("settings.json")}</span>
      <button class="btn" onclick={exportJson}>{t("settings.export_json")}</button>
      <button class="btn" onclick={importJson}>{t("settings.import_json")}</button>
    </div>
    <div class="line">
      <span class="grow">{t("settings.ics")}</span>
      <button class="btn" onclick={exportAllIcs}>{t("settings.export_ics")}</button>
    </div>
    {#if dbPath}<div class="line"><span class="grow">{t("settings.db_location")}</span><span class="faint small path">{dbPath}</span></div>{/if}
    {#if !isTauri}<div class="line faint small">{t("toast.native_only")}</div>{/if}
  </section>

  <section class="card">
    <h2>{t("settings.sample")}</h2>
    <div class="line">
      <span class="grow muted">{t("settings.sample_hint")}</span>
      {#if hasSampleData()}
        <button class="btn danger" onclick={clearSampleData}>{t("settings.clear_sample")}</button>
      {:else}
        <button class="btn" onclick={() => seedSampleData()}>{t("settings.load_sample")}</button>
      {/if}
    </div>
  </section>
</div>

<style>
  .page { height: 100%; overflow-y: auto; padding: 18px 22px 40px; display: flex; flex-direction: column; gap: 12px; max-width: 760px; }
  section { padding: 10px 14px 6px; }
  h2 { padding-bottom: 4px; }
  .line { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 4px 0; border-top: 0.5px solid var(--border); }
  h2 + .line { border-top: 0; }
  .small { font-size: 11px; }
  .path { user-select: text; -webkit-user-select: text; word-break: break-all; }
  .num { width: 70px; text-align: right; }
  .seg { gap: 0; }
  .seg .btn:first-child { border-radius: 6px 0 0 6px; }
  .seg .btn:last-child { border-radius: 0 6px 6px 0; margin-left: -0.5px; }
  .hotkey { min-width: 120px; justify-content: center; font-variant-numeric: tabular-nums; letter-spacing: 0.05em; }
</style>
