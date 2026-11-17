// Data model shared by every feature. Timestamps are epoch milliseconds.

export type Status = "lead" | "active" | "waiting" | "closed";
export type Stage = "new" | "in_progress" | "won" | "lost";
export type ActivityType = "call" | "email" | "meeting" | "note";
export type Repeat = "none" | "daily" | "weekly" | "monthly";

export const STATUSES: Status[] = ["lead", "active", "waiting", "closed"];
export const STAGES: Stage[] = ["new", "in_progress", "won", "lost"];
export const ACTIVITY_TYPES: ActivityType[] = ["call", "email", "meeting", "note"];
export const REPEATS: Repeat[] = ["none", "daily", "weekly", "monthly"];

export interface Contact {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  tags: string[];
  status: Status;
  notes: string;
  created_at: number;
  updated_at: number;
  last_contacted_at: number | null;
  is_sample: number;
}

export interface Deal {
  id: string;
  contact_id: string | null;
  title: string;
  value: number;
  stage: Stage;
  due_date: number | null;
  notes: string;
  created_at: number;
  updated_at: number;
  is_sample: number;
}

export interface Activity {
  id: string;
  contact_id: string;
  type: ActivityType;
  text: string;
  timestamp: number;
  is_sample: number;
}

export interface Reminder {
  id: string;
  title: string;
  datetime: number;
  duration: number | null; // minutes
  contact_id: string | null;
  deal_id: string | null;
  done: boolean;
  done_at: number | null;
  repeat: Repeat;
  snoozed_until: number | null;
  created_at: number;
  is_sample: number;
}

export type Lang = "lv" | "en";
export type EnDateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";

export interface Settings {
  language: Lang;
  en_date_format: EnDateFormat;
  untouched_days: number;
  tomorrow_time: string; // "HH:MM"
  hotkey: string;
  autostart: boolean;
  show_dock: boolean;
  backup_dir: string; // empty = ~/Documents/CRM Backups
  last_auto_backup: string; // "YYYY-MM-DD"
  last_run_at: number;
  seeded: boolean;
  notifications_asked: boolean;
  /** Two-way sync with the "CRM" calendar in Apple Calendar. */
  calendar_sync: boolean;
  /** EventKit identifier of the "CRM" calendar. */
  calendar_id: string;
  /** Show Apple Intelligence features (when the model is available). */
  ai_enabled: boolean;
  /** Allow Apple's cloud model when the on-device one can't do the job. */
  ai_cloud: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  language: "lv",
  en_date_format: "DD/MM/YYYY",
  untouched_days: 30,
  tomorrow_time: "09:00",
  hotkey: "Ctrl+Alt+Space",
  autostart: false,
  show_dock: true,
  backup_dir: "",
  last_auto_backup: "",
  last_run_at: 0,
  seeded: false,
  notifications_asked: false,
  calendar_sync: false,
  calendar_id: "",
  ai_enabled: true,
  ai_cloud: false,
};

/** Column lists drive the generic INSERT/UPDATE helpers in store.svelte.ts. */
export const COLUMNS = {
  contacts: ["id", "name", "company", "email", "phone", "tags", "status", "notes", "created_at", "updated_at", "last_contacted_at", "is_sample"],
  deals: ["id", "contact_id", "title", "value", "stage", "due_date", "notes", "created_at", "updated_at", "is_sample"],
  activities: ["id", "contact_id", "type", "text", "timestamp", "is_sample"],
  reminders: ["id", "title", "datetime", "duration", "contact_id", "deal_id", "done", "done_at", "repeat", "snoozed_until", "created_at", "is_sample"],
} as const;

export type TableName = keyof typeof COLUMNS;
export interface Tables {
  contacts: Contact;
  deals: Deal;
  activities: Activity;
  reminders: Reminder;
}
