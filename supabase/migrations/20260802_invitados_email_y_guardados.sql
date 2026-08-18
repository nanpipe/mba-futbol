-- ════════════════════════════════════════════════════════════════════════════
-- Invitados: optional email + a per-player saved-guest address book.
--
-- 1. invitados.email — optional. When set, the guest is emailed directly the
--    moment they get a spot, instead of only telling the player who invited them.
-- 2. invitados_guardados — players keep their regulars here (name + email) so
--    they don't retype them every match.
-- Run once in the Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.invitados
  ADD COLUMN IF NOT EXISTS email text;

-- Sent-once guard so a guest isn't emailed again on every cron tick.
ALTER TABLE public.invitados
  ADD COLUMN IF NOT EXISTS notif_confirmado_sent boolean NOT NULL DEFAULT false;

-- Guests already confirmed shouldn't get a surprise email about a past match.
UPDATE public.invitados SET notif_confirmado_sent = true WHERE estado = 'confirmado';

CREATE TABLE IF NOT EXISTS public.invitados_guardados (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid        NOT NULL REFERENCES public.clubs(id),
  player_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nombre      text        NOT NULL,
  email       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- One entry per name per player; keeps the list from filling with duplicates.
  UNIQUE (player_id, nombre)
);

ALTER TABLE public.invitados_guardados ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_invitados_guardados_player
  ON public.invitados_guardados(player_id, nombre);

-- A player only ever sees and edits their own saved guests. Writes also go
-- through the service-role API, which re-checks ownership.
DROP POLICY IF EXISTS "invitados_guardados own read" ON public.invitados_guardados;
CREATE POLICY "invitados_guardados own read"
  ON public.invitados_guardados FOR SELECT TO authenticated
  USING (player_id = auth.uid());
