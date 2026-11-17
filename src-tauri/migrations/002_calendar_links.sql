-- Migration 002: two-way Apple Calendar sync.
-- One row per reminder that has an event in the "CRM" calendar, with the values
-- last written to / read from that event. Comparing both sides against this
-- snapshot tells which side changed, and makes our own writes a no-op.
-- No foreign key on purpose: after a reminder is deleted its link must survive
-- until the next sync has deleted the event.

CREATE TABLE IF NOT EXISTS calendar_links (
  reminder_id  TEXT PRIMARY KEY,
  event_id     TEXT,
  synced_title TEXT NOT NULL DEFAULT '',
  synced_start INTEGER NOT NULL,
  synced_end   INTEGER NOT NULL,
  synced_at    INTEGER NOT NULL
);
