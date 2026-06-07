-- ════════════════════════════════════════════════════════════════════════════
-- pg_cron DIAGNOSTIC — run each block in Supabase SQL editor, read output
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Are the extensions even installed?
--    Need BOTH: pg_cron (scheduler) + pg_net (HTTP calls out).
SELECT extname, extversion
FROM pg_extension
WHERE extname IN ('pg_cron', 'pg_net');
-- Expect 2 rows. If pg_cron missing → no scheduler. If pg_net missing → can't call API.
-- Enable in Supabase: Dashboard → Database → Extensions → toggle pg_cron + pg_net.


-- 2) What jobs are scheduled?
SELECT jobid, schedule, command, active, jobname
FROM cron.job
ORDER BY jobid;
-- Expect a row per cron (notificaciones / cupos / pre-apertura / check).
-- If EMPTY → no jobs created → that's why nothing fires. (See block 6 to create.)
-- Check: does `command` contain the CORRECT production URL + correct Bearer secret?


-- 3) Recent run history — did they execute? did they succeed?
SELECT j.jobname, r.status, r.return_message, r.start_time, r.end_time
FROM cron.job_run_details r
JOIN cron.job j ON j.jobid = r.jobid
ORDER BY r.start_time DESC
LIMIT 30;
-- status 'succeeded' = pg_cron ran the command (NOT that the HTTP call returned 200).
-- With pg_net, the command just QUEUES an async request → 'succeeded' even if the
-- HTTP later 401'd. Must check block 4 for the actual HTTP response.


-- 4) Actual HTTP responses from pg_net (the real truth)
SELECT id, status_code, content::text, created
FROM net._http_response
ORDER BY created DESC
LIMIT 20;
-- status_code 200 = endpoint ran OK.
-- 401 = Bearer secret mismatch (cron.job command secret ≠ CRON_SECRET in Vercel).
-- 404/000 = wrong URL.
-- If table empty / no recent rows → pg_net never sent → job command not using net.http_get.


-- 5) Inspect a job's exact command (look for URL + secret)
SELECT jobid, jobname, command FROM cron.job;
-- The command should look like:
--   select net.http_get(
--     url := 'https://futbol.niebla.co/api/cron/notificaciones',
--     headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
--   );
-- Verify the secret here EXACTLY equals Vercel env CRON_SECRET. Mismatch → 401.


-- ════════════════════════════════════════════════════════════════════════════
-- 6) (RE)CREATE the daily cron — run only if block 2 was empty or wrong.
--    Replace <CRON_SECRET> with the EXACT value from Vercel env.
--    Schedule: 17:00 UTC = 12:00 Colombia (UTC-5). Adjust as needed.
-- ════════════════════════════════════════════════════════════════════════════

-- Remove old (ignore errors if they don't exist)
-- SELECT cron.unschedule('mba_notificaciones');

-- SELECT cron.schedule(
--   'mba_notificaciones',
--   '0 17 * * *',                       -- every day 17:00 UTC (noon Colombia)
--   $$
--   select net.http_get(
--     url := 'https://futbol.niebla.co/api/cron/notificaciones',
--     headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
--   );
--   $$
-- );

-- Verify it was created:
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'mba_notificaciones';
