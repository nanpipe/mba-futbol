-- Allow 'superadmin' role everywhere 'admin' was previously accepted

-- 1. profiles check constraint
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('player', 'admin', 'superadmin'));

-- 2. RLS: profiles select
-- "Admin ve todos los perfiles" is dropped — "Lectura de perfiles" (true) already
-- makes all rows readable; keeping a self-referential SELECT policy caused
-- infinite recursion → 500 for every user.
DROP POLICY IF EXISTS "Admin ve todos los perfiles" ON public.profiles;

-- 3. RLS: profiles update — scalar subquery avoids self-referential recursion
DROP POLICY IF EXISTS "Admin actualiza perfiles" ON public.profiles;
CREATE POLICY "Admin actualiza perfiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

-- 4. RLS: partidos
DROP POLICY IF EXISTS "Solo admin modifica partidos" ON public.partidos;
CREATE POLICY "Solo admin modifica partidos"
  ON public.partidos FOR ALL
  TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

-- 5. RLS: inscripciones
DROP POLICY IF EXISTS "Admin gestiona todas las inscripciones" ON public.inscripciones;
CREATE POLICY "Admin gestiona todas las inscripciones"
  ON public.inscripciones FOR ALL
  TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

-- 6. RLS: player_badges
DROP POLICY IF EXISTS "Admin full access on player_badges" ON public.player_badges;
CREATE POLICY "Admin full access on player_badges"
  ON public.player_badges FOR ALL
  TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );
