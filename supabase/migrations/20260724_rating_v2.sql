-- ════════════════════════════════════════════════════════════════════════════
-- Rating v2 — stateful, earned-on-the-field score.
--
-- The old system based the score on a self-reported FIFA card (OVR) plus a
-- capped modifier. Players self-rated high, the card froze once approved, and
-- nothing pulled the score down. This replaces it with a stateful 1–5 rating
-- that starts at 3.0 and moves by tiny per-match deltas (±0.02), so the number
-- reflects current, real activity and results.
--
-- profiles.habilidad becomes the single source of truth for the rating.
-- The FIFA card (evaluaciones_carta) is removed. The photo lives on
-- profiles.avatar_url and is untouched.
-- Run once in the Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Reset everyone to the neutral starting rating. Fresh season, 3.0 for all.
UPDATE public.profiles SET habilidad = 3.0;

-- 2. Ledger of applied per-match rating deltas.
--    UNIQUE(partido_id, player_id) makes delta application idempotent, and the
--    stored delta lets us reverse a match cleanly (e.g. admin reopens voting).
CREATE TABLE IF NOT EXISTS public.rating_events (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       uuid         NOT NULL REFERENCES public.clubs(id),
  player_id     uuid         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  partido_id    uuid         NOT NULL REFERENCES public.partidos(id) ON DELETE CASCADE,
  delta         numeric(5,3) NOT NULL,
  motivos       jsonb        NOT NULL DEFAULT '[]',
  rating_after  numeric(4,3) NOT NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (partido_id, player_id)
);

ALTER TABLE public.rating_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_rating_events_player  ON public.rating_events(player_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rating_events_partido ON public.rating_events(partido_id);

-- Read within own club. Writes go through the service-role API only.
CREATE POLICY "rating_events club read"
  ON public.rating_events FOR SELECT TO authenticated
  USING (club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()));

-- 3. Kill the FIFA card. Photo (profiles.avatar_url) is independent and stays.
DROP TABLE IF EXISTS public.evaluaciones_carta CASCADE;
