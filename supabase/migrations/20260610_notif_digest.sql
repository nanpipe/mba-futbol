-- ════════════════════════════════════════════════════════════════════════════
-- Notification digest queue. High-frequency admin alerts (signup, inscripción,
-- baja) are enqueued here and flushed by cron as ONE summary per club, instead
-- of one email/push per event. Run once in Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.notif_digest (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid        NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  evento      text        NOT NULL,   -- 'signup' | 'inscripcion' | 'baja'
  mensaje     text        NOT NULL,   -- one-line summary of the single event
  enviado     boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notif_digest ENABLE ROW LEVEL SECURITY;

-- Pending rows per club, oldest first — drives the cron flush.
CREATE INDEX IF NOT EXISTS idx_notif_digest_pending
  ON public.notif_digest(club_id, enviado, created_at);

-- No authenticated policies: written + read only by the service-role cron/API.
