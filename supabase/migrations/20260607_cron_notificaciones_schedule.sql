-- ════════════════════════════════════════════════════════════════════════════
-- Reschedule daily notificaciones cron → 14:55 UTC = 09:55 Colombia (UTC-5).
-- Run once in Supabase SQL editor. Requires pg_cron + pg_net enabled.
--
-- This run handles: apertura (timestamp OR auto-fallback by opening day),
-- recordatorio, cupos, dia_antes, invitados, promovidos.
-- The separate 'mbafc-pre-apertura' (every minute) job is left untouched.
-- ════════════════════════════════════════════════════════════════════════════

-- Drop existing job by name (no-op if it doesn't exist)
DO $$
BEGIN
  PERFORM cron.unschedule('mbafc-notificaciones');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- (Re)create at 09:55 Colombia
SELECT cron.schedule(
  'mbafc-notificaciones',
  '55 14 * * *',
  $job$
  SELECT net.http_get(
    url := 'https://mba-futbol.vercel.app/api/cron/notificaciones',
    headers := '{"Authorization":"Bearer cronsecretkey234DSF3SD444Slsko-esj%%E6S"}'::jsonb
  );
  $job$
);

-- Verify
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'mbafc-notificaciones';
