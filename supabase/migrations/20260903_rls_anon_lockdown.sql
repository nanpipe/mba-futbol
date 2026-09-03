-- ════════════════════════════════════════════════════════════════════════════
-- URGENT — `profiles` and `invitados` are readable by anyone.
--
-- Verified against production with the public anon key and NO session:
--     profiles   38 of 38 rows returned  (email, ip_registro, role, habilidad)
--     invitados  25 of 25 rows returned  (guest names and emails)
-- Every other table filtered correctly to 0 rows, so this is specific to these
-- two: a permissive policy is granting `anon` full read.
--
-- The anon key ships inside every browser bundle, so this is public data today.
--
-- Before running this, deploy the code change that moves the login, signup and
-- password-recovery lookups to /api/auth/resolver — those three screens read
-- `profiles` before a session exists and would otherwise break.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitados ENABLE ROW LEVEL SECURITY;

-- Drop any policy that grants the anon role access to these tables. Named
-- variants from earlier schema iterations are dropped explicitly; the DO block
-- then sweeps up anything else still open to anon.
DROP POLICY IF EXISTS "Lectura de perfiles"        ON public.profiles;
DROP POLICY IF EXISTS "Perfiles visibles"          ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable" ON public.profiles;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.profiles;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('profiles', 'invitados')
      -- 'anon' explicitly listed, or {public} which includes anon
      AND ('anon' = ANY(roles) OR 'public' = ANY(roles))
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    RAISE NOTICE 'dropped anon-readable policy % on %', r.policyname, r.tablename;
  END LOOP;
END $$;

-- Re-assert the intended reads for signed-in club members. CREATE OR REPLACE
-- isn't available for policies, so drop-then-create keeps this re-runnable.
DROP POLICY IF EXISTS "Ver perfiles del club" ON public.profiles;
CREATE POLICY "Ver perfiles del club"
  ON public.profiles FOR SELECT TO authenticated
  USING (club_id = (SELECT club_id FROM public.profiles p WHERE p.id = auth.uid()));

-- invitados: members read their club's guests; every write goes through the
-- service-role API, which enforces the guest limit, the signup window and
-- ownership. The previous FOR ALL policy let a member insert a confirmed guest
-- directly and skip all of it.
DROP POLICY IF EXISTS "Club members access invitados" ON public.invitados;
DROP POLICY IF EXISTS "Club members leen invitados"   ON public.invitados;
CREATE POLICY "Club members leen invitados"
  ON public.invitados FOR SELECT TO authenticated
  USING (club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()));

-- Same shape on two more tables: read-only from the client, written only by the
-- API. FOR ALL let a member move themselves onto the winning team, or stuff
-- recognition votes (which feed badges, which feed the rating).
DROP POLICY IF EXISTS "Club members leen equipo_jugadores" ON public.equipo_jugadores;
CREATE POLICY "Club members leen equipo_jugadores"
  ON public.equipo_jugadores FOR SELECT TO authenticated
  USING (club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Club members votan" ON public.votos_reconocimiento;
CREATE POLICY "Club members leen votos"
  ON public.votos_reconocimiento FOR SELECT TO authenticated
  USING (club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()));

-- Verify afterwards: with the anon key and no session, all four must return 0.
