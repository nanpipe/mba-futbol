-- ════════════════════════════════════════════════════════════════════════════
-- URGENT: partidos.notif_dia_antes_sent was referenced by the cron but never
-- created by any migration.
--
-- The cron selects it in the query that drives the whole per-match section, so
-- PostgREST failed the query, `partidos` came back empty, and everything in
-- that loop silently did nothing: the day-before reminder, the "cupos
-- disponibles" push, the 2 PM guest promotion and the auto-generated team
-- draft. It fails quietly, which is why it went unnoticed.
-- Run this in the Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.partidos
  ADD COLUMN IF NOT EXISTS notif_dia_antes_sent boolean NOT NULL DEFAULT false;

-- Past matches shouldn't fire a "match is tomorrow" reminder.
UPDATE public.partidos
  SET notif_dia_antes_sent = true
  WHERE fecha < CURRENT_DATE;
