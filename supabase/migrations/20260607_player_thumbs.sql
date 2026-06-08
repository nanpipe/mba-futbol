-- ════════════════════════════════════════════════════════════════════════════
-- Peer thumbs up/down per match. Feeds the player rating (Phase 2).
-- One thumb per (match, voter, target). Run once in Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.player_thumbs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid        NOT NULL REFERENCES public.clubs(id),
  partido_id  uuid        NOT NULL REFERENCES public.partidos ON DELETE CASCADE,
  votante_id  uuid        NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  votado_id   uuid        NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  value       smallint    NOT NULL CHECK (value IN (-1, 1)),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partido_id, votante_id, votado_id)
);

ALTER TABLE public.player_thumbs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_player_thumbs_votado ON public.player_thumbs(votado_id, created_at);
CREATE INDEX IF NOT EXISTS idx_player_thumbs_partido ON public.player_thumbs(partido_id);

-- Read within own club. Writes go through the service-role API (validated there),
-- so no INSERT policy for authenticated — anon/authenticated cannot write directly.
CREATE POLICY "thumbs club read"
  ON public.player_thumbs FOR SELECT TO authenticated
  USING (club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()));
