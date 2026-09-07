-- ════════════════════════════════════════════════════════════════════════════
-- HOTFIX — the app is down: "Club no encontrado", no avatar, cupos 0/14.
--
-- 20260903_rls_anon_lockdown.sql left profiles with a policy that queries
-- profiles inside its own USING clause:
--
--     USING (club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()))
--
-- Postgres applies RLS to that inner SELECT too, so the policy recurses and
-- every read of profiles errors out. It was harmless before only because the
-- permissive anon policy was OR'd in front of it and short-circuited the
-- evaluation — dropping that policy is what exposed the recursion.
--
-- Fix: resolve the caller's club through a SECURITY DEFINER function, which
-- runs as the owner and therefore does not re-enter RLS.
-- Run this in the Supabase SQL editor. It supersedes nothing else in the
-- lockdown migration — anon stays locked out.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.mi_club_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT club_id FROM public.profiles WHERE id = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.mi_club_id() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mi_club_id() TO authenticated;

-- profiles: own row always, plus everyone in the same club — no self-reference.
DROP POLICY IF EXISTS "Ver perfiles del club" ON public.profiles;
CREATE POLICY "Ver perfiles del club"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR club_id = public.mi_club_id());

-- The other lockdown policies subquery profiles from a *different* table, so
-- they never recursed. Point them at the function anyway: one way of resolving
-- the club, and it skips a nested RLS check on every row.
DROP POLICY IF EXISTS "Club members leen invitados" ON public.invitados;
CREATE POLICY "Club members leen invitados"
  ON public.invitados FOR SELECT TO authenticated
  USING (club_id = public.mi_club_id());

DROP POLICY IF EXISTS "Club members leen equipo_jugadores" ON public.equipo_jugadores;
CREATE POLICY "Club members leen equipo_jugadores"
  ON public.equipo_jugadores FOR SELECT TO authenticated
  USING (club_id = public.mi_club_id());

DROP POLICY IF EXISTS "Club members leen votos" ON public.votos_reconocimiento;
CREATE POLICY "Club members leen votos"
  ON public.votos_reconocimiento FOR SELECT TO authenticated
  USING (club_id = public.mi_club_id());

-- Sanity check: must return 0 rows for anon, and the app must load again.
