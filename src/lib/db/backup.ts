// Backups and import/export:
//  * one-click copy of the SQLite file (default folder ~/Documents/CRM Backups)
//  * automatic daily backup, the newest 14 are kept (pruned in Rust)
//  * restore from a backup file
//  * whole database as JSON, and reminders as .ics

import { closeDb, contactById, data, exportDump, importDump, rawSelect, setSetting, type Dump } from "./store.svelte";
import { confirmDialog, invoke, isTauri, pickFile, saveTextFile } from "../native";
import { t } from "../i18n/index.svelte";
import { toDateKey } from "../i18n/format";
import { toIcs } from "../reminders/ics";
import { toast } from "../ui/state.svelte";
import type { Reminder } from "./types";

export async function backupFolder(): Promise<string> {
  return data.settings.backup_dir || (await invoke<string>("default_backup_dir")) || "";
}

/** Copy the database file into the backup folder. Returns the new file's path. */
export async function backupNow(auto = false): Promise<string | null> {
  if (!isTauri) return null;
  // Make sure everything is in the main database file before copying it.
  await rawSelect("PRAGMA wal_checkpoint(TRUNCATE)");
  const path = await invoke<string>("backup_db", { folder: await backupFolder(), auto });
  return path ?? null;
}

export async function backupNowWithToast(): Promise<void> {
  try {
    const path = await backupNow(false);
    toast(path ? t("toast.backup_done", { path }) : t("toast.native_only"));
  } catch (err) {
    toast(t("toast.backup_failed", { error: String(err) }), { error: true });
  }
}

/** Called on startup and on every native tick: at most one automatic backup per day. */
export async function autoBackupIfDue(): Promise<void> {
  const today = toDateKey(Date.now());
  if (!isTauri || data.settings.last_auto_backup === today) return;
  setSetting("last_auto_backup", today); // set first so a failure does not retry every few seconds
  try {
    await backupNow(true);
  } catch (err) {
    console.error("automatic backup failed", err);
  }
}

export async function restoreFromBackup(): Promise<void> {
  const path = await pickFile(["sqlite", "db"], await backupFolder());
  if (!path) return;
  if (!(await confirmDialog(t("settings.restore_confirm"), t("settings.restore")))) return;
  try {
    await backupNow(false); // safety copy of the current state
    await closeDb();
    await invoke("restore_db", { path });
    location.reload();
  } catch (err) {
    toast(t("toast.restore_failed", { error: String(err) }), { error: true });
  }
}

export async function exportJson(): Promise<void> {
  const name = `crm-export-${toDateKey(Date.now())}.json`;
  const path = await saveTextFile(name, JSON.stringify(exportDump(), null, 2), "json");
  if (path) toast(t("toast.exported", { path }));
}

export async function importJson(): Promise<void> {
  const path = await pickFile(["json"]);
  if (!path) return;
  if (!(await confirmDialog(t("settings.import_confirm"), t("settings.import_json")))) return;
  try {
    const text = await invoke<string>("read_text_file", { path });
    const dump = JSON.parse(text ?? "") as Dump;
    await backupNow(false); // safety copy before replacing everything
    await importDump(dump);
    toast(t("toast.imported"));
  } catch (err) {
    toast(t("toast.import_failed", { error: String(err) }), { error: true });
  }
}

const nameOf = (id: string | null) => contactById(id)?.name;

/** Full .ics export of every reminder/event. */
export async function exportAllIcs(): Promise<void> {
  const name = `crm-calendar-${toDateKey(Date.now())}.ics`;
  const path = await saveTextFile(name, toIcs(data.reminders, nameOf), "ics");
  if (path) toast(t("toast.exported", { path }));
}

/** "Export to calendar" for one reminder: opens the .ics so Apple Calendar offers to add it. */
export async function exportReminderIcs(r: Reminder): Promise<void> {
  const ics = toIcs([r], nameOf);
  if (isTauri) await invoke("open_ics", { name: `reminder-${r.id}`, contents: ics });
  else await saveTextFile("crm-reminder.ics", ics, "ics");
}
