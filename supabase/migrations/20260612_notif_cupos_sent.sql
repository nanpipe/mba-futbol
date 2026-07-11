-- ════════════════════════════════════════════════════════════════════════════
-- Once-only flag for the "cupos disponibles" push. The cron now runs every
-- minute; without this flag the cupos push repeated every minute while the
-- inscription window was open. Run once in Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.partidos
  ADD COLUMN IF NOT EXISTS notif_cupos_sent boolean NOT NULL DEFAULT false;
