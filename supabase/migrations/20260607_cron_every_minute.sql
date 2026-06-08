-- ════════════════════════════════════════════════════════════════════════════
-- Consolidate crons: remove pre-apertura job, reschedule notificaciones to
-- run every minute. All timing logic now lives in the endpoint via
-- calcularVentanaPartido — apertura fires 5 min before window opens,
-- recordatorio fires 9 h before match.
-- Run once in Supabase SQL editor. Requires pg_cron + pg_net enabled.
-- ════════════════════════════════════════════════════════════════════════════

-- Unschedule pre-apertura (folded into notificaciones)
DO $$
BEGIN
  PERFORM cron.unschedule('mbafc-pre-apertura');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Drop existing notificaciones job (no-op if it doesn't exist)
DO $$
BEGIN
  PERFORM cron.unschedule('mbafc-notificaciones');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Reschedule notificaciones at every-minute metronome
SELECT cron.schedule(
  'mbafc-notificaciones',
  '* * * * *',
  $job$
  SELECT net.http_get(
    url := 'https://mba-futbol.vercel.app/api/cron/notificaciones',
    headers := '{"Authorization":"Bearer cronsecretkey234DSF3SD444Slsko-esj%%E6S"}'::jsonb
  );
  $job$
);

-- Verify
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname LIKE 'mbafc-%';
