-- ════════════════════════════════════════════════════════════════════════════
-- Venue per match. Run once in Supabase SQL editor.
-- Venue list itself lives in app_settings key 'ubicaciones' (one per line,
-- first line = default) — no separate table needed.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.partidos
  ADD COLUMN IF NOT EXISTS lugar text;
