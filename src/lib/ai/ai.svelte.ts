// Apple Intelligence on the frontend: availability state, the call wrapper and
// error texts. The model runs on this Mac (Foundation Models via the Swift
// bridge in src-tauri/swift/CRMIntelligence); Apple's cloud model is used only
// when the user switched it on and the local model can't do the job.

import { data, setSetting } from "../db/store.svelte";
import { locale, t } from "../i18n/index.svelte";
import { invoke, isTauri } from "../native";
import { toast } from "../ui/state.svelte";

export const ai = $state({
  checked: false,
  local: { available: false, reason: "", languages: [] as string[] },
  cloud: { available: false, reason: "" },
  probing: false,
});

/** Whether AI buttons should be shown at all. */
export function aiReady(): boolean {
  if (!data.settings.ai_enabled) return false;
  return ai.local.available || (data.settings.ai_cloud && ai.cloud.available);
}

export interface AiMeta {
  ok: true;
  model: "local" | "cloud";
  /** Language the model was asked to answer in ("en" when Latvian isn't supported). */
  language: string;
  cloud_error?: string;
}

export class AiError extends Error {
  constructor(public code: string, public detail = "") {
    super(code);
  }
}

/** Run one Apple Intelligence operation (see CRMIntelligence.swift). */
export async function aiCall<T>(op: string, input: Record<string, unknown> = {}): Promise<T & AiMeta> {
  if (!isTauri) throw new AiError("unavailable");
  const out = await invoke<Record<string, unknown>>("ai_call", {
    op,
    input: { lang: locale.lang, allow_cloud: data.settings.ai_cloud, ...input },
  });
  if (!out || out.ok !== true) throw new AiError(String(out?.error ?? "failed"), String(out?.detail ?? ""));
  return out as T & AiMeta;
}

export function aiErrorText(err: unknown): string {
  const code = err instanceof AiError ? err.code : "failed";
  const key = `ai.err.${code}`;
  const text = t(key);
  return text === key ? t("ai.err.failed") : text;
}

export async function checkAi(): Promise<void> {
  if (!isTauri) { ai.checked = true; return; }
  try {
    const out = await invoke<{ local: typeof ai.local; cloud: typeof ai.cloud }>("ai_call", { op: "availability", input: {} });
    if (out) {
      ai.local = { available: !!out.local.available, reason: out.local.reason ?? "", languages: out.local.languages ?? [] };
      ai.cloud = { available: !!out.cloud.available, reason: out.cloud.reason ?? "" };
    }
  } catch (err) {
    console.error("Apple Intelligence check failed", err);
  }
  ai.checked = true;
}

/**
 * Settings switch for Apple's cloud model. Enabling makes one tiny real call,
 * because the cloud model reports "available" even when this app is not
 * entitled to use it.
 */
export async function setCloudEnabled(on: boolean): Promise<void> {
  if (!on) { setSetting("ai_cloud", false); return; }
  ai.probing = true;
  try {
    await aiCall("probe_cloud");
    setSetting("ai_cloud", true);
    toast(t("ai.cloud_enabled"));
  } catch (err) {
    setSetting("ai_cloud", false);
    toast(aiErrorText(err), { error: true });
  } finally {
    ai.probing = false;
  }
}

/** Small label shown under AI results: which model, and whether it answered in English. */
export function aiResultLabel(meta: AiMeta): string {
  const parts = [t(meta.model === "cloud" ? "ai.label_cloud" : "ai.label_local")];
  if (locale.lang !== "en" && meta.language === "en") parts.push(t("ai.answered_english"));
  return parts.join(" · ");
}
