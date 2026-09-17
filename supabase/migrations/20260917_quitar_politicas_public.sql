-- ════════════════════════════════════════════════════════════════════════════
-- Quitar TODAS las políticas concedidas a PUBLIC. Son catorce, y ninguna hace falta.
--
-- La auditoría destapó el mismo patrón en media base: políticas creadas desde
-- el dashboard, sin TO, que por defecto quedan concedidas a PUBLIC — el rol que
-- incluye a anon Y a cualquier jugador con sesión. Las peores:
--
--   partidos_insert / _update / _delete   {public}   crear, cambiar y BORRAR partidos
--   Admin full access on equipos          ALL {public}
--   Admin full access on equipo_jugadores ALL {public}
--   Jugador gestiona sus propias suscrip. ALL {public}
--
-- Las de equipos son las que más duelen, porque 20260903_rls_anon_lockdown.sql
-- se escribió justo para cerrarlas — su comentario dice "FOR ALL let a member
-- move themselves onto the winning team". Creó la versión de solo lectura, pero
-- borró la vieja POR NOMBRE, y estas dos se llamaban distinto. Las políticas se
-- combinan con OR: mientras la floja siguiera ahí, la nueva no servía de nada.
--
-- ── Por qué se pueden quitar las catorce ────────────────────────────────────
-- 1. El navegador NO ESCRIBE en ninguna tabla. Cero insert/update/delete/upsert
--    en los doce archivos que usan el cliente de navegador; todas las
--    escrituras pasan por rutas de API con la service key, que se salta RLS.
--    O sea: ninguna política de escritura de cliente cumple función.
--
-- 2. El navegador solo LEE cinco tablas — partidos, inscripciones, invitados,
--    profiles, player_badges — y las cinco conservan su política SELECT para
--    {authenticated}. equipos y equipo_jugadores no se leen desde el navegador:
--    el panel de equipos va por /api/equipos.
--
-- 3. Cada política {public} de esta base tiene ya su equivalente
--    {authenticated}. Se van las flojas y queda la estricta, en las catorce.
--
-- No se borran por nombre: por nombre es como sobrevivieron hasta hoy.
-- Seguro de re-correr.
-- ════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

DO $$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT tablename, policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND roles && ARRAY['public', 'anon']::name[]
    ORDER BY tablename, policyname
  LOOP
    RAISE NOTICE 'Quitando %.% (%)', r.tablename, r.policyname, r.cmd;
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Listo: % políticas quitadas.', n;
END $$;


-- ── Verificación ────────────────────────────────────────────────────────────

-- 1. Cero filas: ya no queda nada concedido a PUBLIC.
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND roles && ARRAY['public', 'anon']::name[];

-- 2. Las cinco tablas que el navegador lee deben conservar su SELECT para
--    authenticated. Si alguna sale sin política, la app se rompe: avisa.
SELECT t.tabla,
       count(p.policyname) FILTER (WHERE p.cmd IN ('SELECT', 'ALL')) AS politicas_lectura
FROM (VALUES
  ('partidos'), ('inscripciones'), ('invitados'), ('profiles'), ('player_badges')
) AS t(tabla)
LEFT JOIN pg_policies p
  ON p.schemaname = 'public' AND p.tablename = t.tabla
GROUP BY t.tabla
ORDER BY t.tabla;

-- 3. Ninguna tabla puede quedarse sin RLS.
SELECT c.relname AS tabla_sin_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
ORDER BY 1;
