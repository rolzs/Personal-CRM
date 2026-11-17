-- Migration 001: initial schema.
-- Timestamps are Unix epoch milliseconds (local wall-clock is derived in the UI).
-- IDs are UUID strings generated client-side so inserts are optimistic and undoable.

CREATE TABLE IF NOT EXISTS contacts (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL DEFAULT '',
  company           TEXT NOT NULL DEFAULT '',
  email             TEXT NOT NULL DEFAULT '',
  phone             TEXT NOT NULL DEFAULT '',
  tags              TEXT NOT NULL DEFAULT '[]',      -- JSON array of strings
  status            TEXT NOT NULL DEFAULT 'lead',    -- lead | active | waiting | closed
  notes             TEXT NOT NULL DEFAULT '',
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  last_contacted_at INTEGER,
  is_sample         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS deals (
  id         TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT '',
  value      REAL NOT NULL DEFAULT 0,                -- EUR
  stage      TEXT NOT NULL DEFAULT 'new',            -- new | in_progress | won | lost
  due_date   INTEGER,
  notes      TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  is_sample  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS activities (
  id         TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type       TEXT NOT NULL DEFAULT 'note',           -- call | email | meeting | note
  text       TEXT NOT NULL DEFAULT '',
  timestamp  INTEGER NOT NULL,
  is_sample  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reminders (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL DEFAULT '',
  datetime      INTEGER NOT NULL,
  duration      INTEGER,                             -- minutes, optional
  contact_id    TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id       TEXT REFERENCES deals(id) ON DELETE SET NULL,
  done          INTEGER NOT NULL DEFAULT 0,
  done_at       INTEGER,
  repeat        TEXT NOT NULL DEFAULT 'none',        -- none | daily | weekly | monthly
  snoozed_until INTEGER,
  created_at    INTEGER NOT NULL,
  is_sample     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities(contact_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_reminders_datetime ON reminders(datetime);
CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id);
