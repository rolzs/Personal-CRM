// Ephemeral UI state shared across components (never persisted).

export type View = "summary" | "contacts" | "calendar" | "activities" | "settings";
export const VIEWS: View[] = ["summary", "contacts", "calendar", "activities"];

export interface Toast {
  id: number;
  /** Already translated text. */
  text: string;
  undoable: boolean;
  error?: boolean;
}

export const ui = $state({
  view: "summary" as View,
  /** Contact shown in the side panel (Contacts view). */
  selectedContactId: null as string | null,
  /** Status filter of the Contacts view ("" = all); the Summary tiles set it. */
  contactStatus: "" as "" | "lead" | "active" | "waiting" | "closed",
  /** Ask the contact panel to focus + select the name field (new contact). */
  focusName: false,
  /** Contact id for which the inline "Next step?" prompt is showing (after logging an activity). */
  nextStepFor: null as string | null,
  quickAddOpen: false,
  cheatOpen: false,
  toasts: [] as Toast[],
  /** Ticks every 30 s so "N days ago", overdue colours etc. stay fresh. */
  now: Date.now(),
  /** Reminder ids that became due while the app was not running. */
  missed: [] as string[],
  /** Bumped to make the active view focus its search field (Cmd+F). */
  focusSearch: 0,
});

let toastSeq = 0;

export function toast(text: string, opts: { undoable?: boolean; error?: boolean } = {}): void {
  const id = ++toastSeq;
  // Only the newest toast keeps its Undo button – it always refers to the top of the undo stack.
  for (const t of ui.toasts) t.undoable = false;
  ui.toasts.push({ id, text, undoable: !!opts.undoable, error: opts.error });
  if (ui.toasts.length > 3) ui.toasts.shift();
  setTimeout(() => dismissToast(id), opts.error ? 8000 : 5000);
}

export function dismissToast(id: number): void {
  const i = ui.toasts.findIndex((t) => t.id === id);
  if (i >= 0) ui.toasts.splice(i, 1);
}

export function openContact(id: string): void {
  ui.view = "contacts";
  ui.selectedContactId = id;
}
