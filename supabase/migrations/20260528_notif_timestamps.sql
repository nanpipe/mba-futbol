-- Per-match notification timestamps
-- Replaces global-settings timing logic with explicit per-match schedule.
ALTER TABLE public.partidos
  ADD COLUMN IF NOT EXISTS notif_apertura_at  timestamptz,
  ADD COLUMN IF NOT EXISTS notif_recordatorio_at timestamptz;

-- notif_apertura_sent and notif_recordatorio_sent already exist on the table.
-- These new columns hold WHEN to send; sent booleans track IF already sent.
