-- ═══════════════════════════════════════════════════════
-- MBA FC — update CRON_SECRET in pg_cron jobs
-- Replace YOUR_ACTUAL_SECRET with your real CRON_SECRET value
-- ═══════════════════════════════════════════════════════

SELECT cron.unschedule('mbafc-pre-apertura');
SELECT cron.unschedule('mbafc-notificaciones');

SELECT cron.schedule(
  'mbafc-pre-apertura',
  '* * * * *',
  $job$
    SELECT net.http_get(
      url := 'https://mba-futbol.vercel.app/api/cron/pre-apertura',
      headers := '{"Authorization":"Bearer YOUR_ACTUAL_SECRET"}'::jsonb
    )
    WHERE EXISTS (SELECT 1 FROM partidos_pre_apertura());
  $job$
);

SELECT cron.schedule(
  'mbafc-notificaciones',
  '0 15 * * *',
  $job$
    SELECT net.http_get(
      url := 'https://mba-futbol.vercel.app/api/cron/notificaciones',
      headers := '{"Authorization":"Bearer YOUR_ACTUAL_SECRET"}'::jsonb
    );
  $job$
);

-- Verify
SELECT jobid, jobname, schedule FROM cron.job WHERE jobname LIKE 'mbafc-%';
