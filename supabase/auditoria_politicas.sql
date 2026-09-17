-- ════════════════════════════════════════════════════════════════════════════
-- Auditoría de políticas RLS — qué hay de verdad en la base.
--
-- No es una migración: no cambia nada, solo lee. Córrela cuando quieras saber
-- si lo que está en producción coincide con lo que está escrito en este repo.
--
-- Por qué existe: tres veces seguidas aparecieron políticas creadas desde el
-- dashboard que ninguna migración conocía —
--   · storage.objects → listado anónimo de avatars y match-photos
--   · storage.objects → "Users upload own avatar" concedida a {public}
--   · votos_reconocimiento → INSERT desde el cliente, saltándose toda la
--     validación de /api/evaluaciones
--
-- El patrón siempre es el mismo: las políticas se combinan con OR, así que
-- manda la más floja, y una migración que borra por nombre no puede tocar lo
-- que nunca supo que existía. La única defensa es mirar la base, no el repo.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. Lo urgente: políticas que alcanzan a anon ────────────────────────────
-- 'public' incluye a anon. Todo lo que salga aquí es alcanzable SIN SESIÓN, y
-- lo único que lo detiene es su propia expresión (normalmente un auth.uid() que
-- da NULL). Idealmente: cero filas.
SELECT
  schemaname || '.' || tablename AS tabla,
  policyname,
  cmd,
  roles,
  qual       AS using_expr,
  with_check AS check_expr
FROM pg_policies
WHERE roles && ARRAY['public', 'anon']::name[]
ORDER BY
  (cmd = 'ALL') DESC,          -- las FOR ALL primero: cubren lectura Y escritura
  (cmd <> 'SELECT') DESC,      -- después las de escritura
  schemaname, tablename, policyname;


-- ── 2. Tablas con RLS activo y CERO políticas ───────────────────────────────
-- Esto es correcto y deseable para las tablas que solo toca la API con la
-- service key (votos_reconocimiento, player_thumbs, badges_revocados...).
-- Sirve para confirmar que siguen cerradas y que nadie les agregó una política
-- "para probar algo".
SELECT c.relname AS tabla, 'RLS activo, sin políticas' AS estado
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = c.relname
  )
ORDER BY 1;


-- ── 3. Tablas SIN RLS ───────────────────────────────────────────────────────
-- Estas están abiertas a cualquiera con la llave anon. Debería salir vacío.
SELECT c.relname AS tabla, '⚠ SIN RLS' AS estado
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND NOT c.relrowsecurity
ORDER BY 1;


-- ── 4. Políticas que el repo no nombra ──────────────────────────────────────
-- Las escritas aquí se llaman "mbafc_*" o salen textualmente en alguna
-- migración. Las de nombre en inglés con espacios suelen venir del dashboard:
-- no están versionadas, nadie las revisa, y sobreviven a las migraciones que
-- borran por nombre. No todas son un problema — pero ninguna debería ser una
-- sorpresa.
SELECT
  schemaname || '.' || tablename AS tabla,
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE policyname NOT LIKE 'mbafc_%'
  AND schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, cmd, policyname;


-- ── 5. Todo, para comparar contra el repo ───────────────────────────────────
SELECT
  schemaname || '.' || tablename AS tabla,
  policyname, cmd, roles
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, cmd, policyname;
