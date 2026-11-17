// Thin wrapper around the Tauri APIs. In a plain browser (`npm run dev`
// without Tauri) every call is a harmless no-op, so the UI can be developed
// and previewed without the native shell.

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { emit as tauriEmit, listen as tauriListen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type WindowKind = "main" | "quickadd" | "tray";

/** Which of the three windows this webview is. `?window=` works in the browser. */
export function windowKind(): WindowKind {
  const label = isTauri
    ? getCurrentWindow().label
    : new URLSearchParams(location.search).get("window") ?? "main";
  return label === "quickadd" || label === "tray" ? label : "main";
}

export async function invoke<T = void>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!isTauri) return undefined;
  return tauriInvoke<T>(cmd, args);
}

export async function emit(event: string, payload?: unknown): Promise<void> {
  if (isTauri) await tauriEmit(event, payload);
}

export async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  return tauriListen<T>(event, (e) => handler(e.payload));
}

// ── Dialogs ────────────────────────────────────────────────────────────

export async function confirmDialog(message: string, title: string): Promise<boolean> {
  if (!isTauri) return window.confirm(message);
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(message, { title, kind: "warning" });
}

export async function pickFolder(defaultPath?: string): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ directory: true, multiple: false, defaultPath });
  return typeof res === "string" ? res : null;
}

export async function pickFile(extensions: string[], defaultPath?: string): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ multiple: false, defaultPath, filters: [{ name: extensions.join(", "), extensions }] });
  return typeof res === "string" ? res : null;
}

/** Save text through a native save dialog (browser: download). Returns the path or null if cancelled. */
export async function saveTextFile(defaultName: string, contents: string, extension: string): Promise<string | null> {
  if (!isTauri) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([contents]));
    a.download = defaultName;
    a.click();
    URL.revokeObjectURL(a.href);
    return defaultName;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: defaultName, filters: [{ name: extension, extensions: [extension] }] });
  if (!path) return null;
  await tauriInvoke("write_text_file", { path, contents });
  return path;
}

// ── Notifications / autostart ──────────────────────────────────────────

export async function requestNotificationPermission(): Promise<void> {
  if (!isTauri) return;
  const n = await import("@tauri-apps/plugin-notification");
  if (!(await n.isPermissionGranted())) await n.requestPermission();
}

export async function setAutostart(enabled: boolean): Promise<void> {
  if (!isTauri) return;
  const a = await import("@tauri-apps/plugin-autostart");
  if (enabled) await a.enable();
  else if (await a.isEnabled()) await a.disable();
}
