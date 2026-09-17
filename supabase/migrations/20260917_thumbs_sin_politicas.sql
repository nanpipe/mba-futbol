-- ════════════════════════════════════════════════════════════════════════════
-- player_thumbs: cero políticas. Los pulgares son anónimos o no lo son.
--
-- Quedaba `thumbs club read` (SELECT, {authenticated}): cualquier jugador con
-- sesión podía leer la tabla completa, y la tabla trae votante_id Y votado_id.
-- O sea, quién le puso pulgar abajo a quién, en todos los partidos, con abrir la
-- consola del navegador. La pantalla de evaluación dice "Anónimo y opcional".
--
-- Es el mismo agujero que se cerró en votos_reconocimiento
-- (20260917_votos_sin_politicas.sql). Se quedó pendiente a propósito para no
-- estrenar otra migración de RLS el mismo día del despliegue.
--
-- Ahora importa más que antes: hasta el 2026-09-17 los pulgares se guardaban y
-- no los leía nadie, así que filtrar la tabla no cambiaba el rating de nadie.
-- Desde que alimentan el rating, saber quién te bajó el puntaje es justo lo que
-- el anonimato tenía que evitar.
--
-- No hace falta ninguna política: las dos únicas lecturas de esta tabla están en
-- api/evaluaciones y lib/rating, y las dos usan la service key, que se salta RLS.
-- Se borra por barrido, no por nombre — por nombre es como sobrevivieron las
-- otras tres veces.
-- ════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'player_thumbs'
  LOOP
    RAISE NOTICE 'Quitando política sobre player_thumbs: %', r.policyname;
    EXECUTE format('DROP POLICY %I ON public.player_thumbs', r.policyname);
  END LOOP;
END $$;

-- Sin políticas Y sin RLS la tabla quedaría abierta de par en par.
ALTER TABLE public.player_thumbs ENABLE ROW LEVEL SECURITY;

-- Debe devolver 0 filas.
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'player_thumbs';

-- Y con una sesión de jugador normal (no service key), esto debe dar 0:
--   SELECT count(*) FROM public.player_thumbs;
