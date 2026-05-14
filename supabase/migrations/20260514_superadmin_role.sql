-- Allow 'superadmin' role everywhere 'admin' was previously accepted

-- 1. profiles check constraint
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('player', 'admin', 'superadmin'));

-- 2. RLS: profiles select (TO authenticated avoids anon recursion)
DROP POLICY IF EXISTS "Admin ve todos los perfiles" ON public.profiles;
CREATE POLICY "Admin ve todos los perfiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  );

-- 3. RLS: profiles update (TO authenticated avoids anon recursion)
DROP POLICY IF EXISTS "Admin actualiza perfiles" ON public.profiles;
CREATE POLICY "Admin actualiza perfiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  );

-- 4. RLS: partidos
DROP POLICY IF EXISTS "Solo admin modifica partidos" ON public.partidos;
CREATE POLICY "Solo admin modifica partidos"
  ON public.partidos FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  );

-- 5. RLS: inscripciones
DROP POLICY IF EXISTS "Admin gestiona todas las inscripciones" ON public.inscripciones;
CREATE POLICY "Admin gestiona todas las inscripciones"
  ON public.inscripciones FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  );
