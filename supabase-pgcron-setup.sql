-- ═══════════════════════════════════════════════════════
-- MBA FC — pg_cron setup (run once in Supabase SQL editor)
-- Replace YOUR_CRON_SECRET with your actual CRON_SECRET env var value
-- ═══════════════════════════════════════════════════════

-- 1. Enable pg_net (for HTTP calls from Postgres)
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

-- 2. Add pre-apertura notification flag to partidos
ALTER TABLE partidos
  ADD COLUMN IF NOT EXISTS notif_pre_apertura_sent boolean NOT NULL DEFAULT false;

-- 3. Helper function: returns partidos opening in 4–6 min (Colombia time)
CREATE OR REPLACE FUNCTION partidos_pre_apertura()
RETURNS TABLE(id uuid, dia_semana text, hora_apertura text)
LANGUAGE sql STABLE AS $$
  SELECT
    p.id,
    p.dia_semana,
    COALESCE(p.hora_apertura, '10:00:00') AS hora_apertura
  FROM partidos p
  WHERE
    p.fecha >= CURRENT_DATE
    AND NOT COALESCE(p.notif_pre_apertura_sent, false)
    AND (
      (p.fecha::date - (COALESCE(p.dias_antes_apertura, 2) || ' days')::interval)::date
      + COALESCE(p.hora_apertura::time, '10:00:00'::time)
    ) AT TIME ZONE 'America/Bogota'
    BETWEEN NOW() + INTERVAL '4 minutes'
        AND NOW() + INTERVAL '6 minutes'
  LIMIT 1;
$$;

-- 4. pg_cron job: pre-apertura warning (every minute, only calls Vercel if needed)
SELECT cron.schedule(
  'mbafc-pre-apertura',
  '* * * * *',
  $job$
    SELECT net.http_get(
      url := 'https://mba-futbol.vercel.app/api/cron/pre-apertura',
      headers := '{"Authorization":"Bearer YOUR_CRON_SECRET"}'::jsonb
    )
    WHERE EXISTS (SELECT 1 FROM partidos_pre_apertura());
  $job$
);

-- 5. pg_cron job: main daily cron (replaces Vercel cron, more reliable)
--    15:00 UTC = 10:00 AM Colombia
SELECT cron.schedule(
  'mbafc-notificaciones',
  '0 15 * * *',
  $job$
    SELECT net.http_get(
      url := 'https://mba-futbol.vercel.app/api/cron/notificaciones',
      headers := '{"Authorization":"Bearer YOUR_CRON_SECRET"}'::jsonb
    );
  $job$
);

-- ── Verify jobs created ──────────────────────────────────
SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobname LIKE 'mbafc-%';
