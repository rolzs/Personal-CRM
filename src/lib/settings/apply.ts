// Push settings that live outside the webview to the native side:
// menu/tray language, Dock icon, global hotkey, launch at login.

import { data } from "../db/store.svelte";
import { invoke, setAutostart } from "../native";
import { t } from "../i18n/index.svelte";
import { toast } from "../ui/state.svelte";

export async function applyLanguage(): Promise<void> {
  document.documentElement.lang = data.settings.language;
  await invoke("set_language", { lang: data.settings.language });
}

export async function applyDock(): Promise<void> {
  await invoke("set_dock_visible", { visible: data.settings.show_dock });
}

/** Returns false (and tells the user) when the shortcut is invalid or taken. */
export async function applyHotkey(): Promise<boolean> {
  try {
    await invoke("set_hotkey", { shortcut: data.settings.hotkey });
    return true;
  } catch (err) {
    toast(t("settings.hotkey_error", { error: String(err) }), { error: true });
    return false;
  }
}

export async function applyAutostart(): Promise<void> {
  try {
    await setAutostart(data.settings.autostart);
  } catch (err) {
    toast(String(err), { error: true });
  }
}

/** Startup: bring the native side in line with the stored settings. */
export async function applyAllSettings(): Promise<void> {
  await applyLanguage();
  await applyDock();
  await applyHotkey();
}

/** Convert a keydown into a Tauri accelerator string such as "Ctrl+Alt+Space". Null = not complete yet. */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Cmd");
  const code = e.code;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else if (code === "Space") key = "Space";
  else if (code === "Enter") key = "Enter";
  // A global hotkey needs at least one modifier (function keys excepted).
  if (!key || (!mods.length && !/^F\d/.test(key))) return null;
  return [...mods, key].join("+");
}
