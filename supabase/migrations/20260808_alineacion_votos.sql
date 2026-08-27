-- ════════════════════════════════════════════════════════════════════════════
-- Player reactions to the suggested lineup.
--
-- At the club's promo hour the draft is generated automatically; players get to
-- say whether it looks even. One vote per player per match, changeable until
-- the admin confirms. The admin sees the tally while reviewing the draft.
-- Run once in the Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.alineacion_votos (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid        NOT NULL REFERENCES public.clubs(id),
  partido_id  uuid        NOT NULL REFERENCES public.partidos(id) ON DELETE CASCADE,
  player_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 1 = looks even, -1 = looks lopsided
  voto        smallint    NOT NULL CHECK (voto IN (-1, 1)),
  comentario  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partido_id, player_id)
);

ALTER TABLE public.alineacion_votos ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_alineacion_votos_partido
  ON public.alineacion_votos(partido_id);

-- Read within own club (the admin panel shows the tally; players see the count).
-- Writes go through the service-role API, which checks the player actually
-- plays in that match.
CREATE POLICY "alineacion_votos club read"
  ON public.alineacion_votos FOR SELECT TO authenticated
  USING (club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()));

-- Track that the draft was auto-generated, so the every-minute cron does it
-- once and never overwrites an admin's edits.
ALTER TABLE public.partidos
  ADD COLUMN IF NOT EXISTS equipos_autogenerados boolean NOT NULL DEFAULT false;

-- Existing matches already have their teams handled; don't retro-generate.
UPDATE public.partidos SET equipos_autogenerados = true WHERE fecha <= CURRENT_DATE;
