-- ════════════════════════════════════════════════════════════════════════════
-- Quitar TODA política de escritura. El navegador no escribe en ninguna tabla.
--
-- El barrido anterior se llevó las concedidas a PUBLIC. Quedaron las de
-- {authenticated}, que parecen inofensivas y no lo son: cubren a cualquier
-- jugador con sesión, que es precisamente quien tiene motivos para abusarlas.
--
-- ── La grave: profiles ──────────────────────────────────────────────────────
--   Usuario actualiza propio perfil   UPDATE  {authenticated}
--
-- RLS NO restringe por columna. Una política que deja actualizar la fila propia
-- deja actualizar TODAS sus columnas, no solo las que la app piensa exponer.
-- /api/perfil tiene lista blanca estricta — avatar_url, posicion, posiciones,
-- username — pero esa lista vive en el servidor. Escribiendo directo desde la
-- consola del navegador no corre:
--
--   update profiles set role = 'superadmin' where id = auth.uid()
--   update profiles set habilidad = 5.0, aprobado = true, baneado = false ...
--
-- Eso es escalada de privilegios, rating a gusto y saltarse un baneo.
--
-- ── La otra: inscripciones ──────────────────────────────────────────────────
--   Usuario se inscribe         INSERT  {authenticated}
--   Usuario cancela inscripción DELETE  {authenticated}
--
-- Toda la lógica de inscripción vive en /api/inscripciones: aprobado, no
-- baneado, ventana de apertura, cupos, y la regla de "sin uniforme siempre a
-- espera, sin excepciones". Un INSERT directo se salta las cinco — entra
-- confirmado sin uniforme y con el partido lleno. El DELETE directo se salta la
-- regla de que un confirmado no puede retirarse.
--
-- ── Por qué se pueden quitar todas ──────────────────────────────────────────
-- El navegador no escribe NADA: cero insert/update/delete/upsert y cero .rpc()
-- en los doce archivos que usan el cliente de navegador. Cada escritura de esta
-- app pasa por una ruta de API con la service key, que se salta RLS. Estas
-- políticas no habilitan ninguna función del producto; solo abren un camino
-- paralelo que evita todas las validaciones.
--
-- Las de SELECT no se tocan: de ahí vive la app.
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
      AND cmd <> 'SELECT'          -- ALL, INSERT, UPDATE, DELETE
    ORDER BY tablename, policyname
  LOOP
    RAISE NOTICE 'Quitando %.% (%)', r.tablename, r.policyname, r.cmd;
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Listo: % políticas de escritura quitadas.', n;
END $$;


-- ── Verificación ────────────────────────────────────────────────────────────

-- 1. Cero filas: no queda ninguna política de escritura.
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND cmd <> 'SELECT';

-- 2. Las cinco tablas que el navegador lee deben conservar su SELECT.
--    Si alguna sale en 0, la app se rompe: avisa antes de seguir.
SELECT t.tabla, count(p.policyname) AS politicas_select
FROM (VALUES
  ('partidos'), ('inscripciones'), ('invitados'), ('profiles'), ('player_badges')
) AS t(tabla)
LEFT JOIN pg_policies p
  ON p.schemaname = 'public' AND p.tablename = t.tabla AND p.cmd = 'SELECT'
GROUP BY t.tabla
ORDER BY t.tabla;

-- 3. Estado final completo, para dejarlo registrado.
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
