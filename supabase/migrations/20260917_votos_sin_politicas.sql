-- ════════════════════════════════════════════════════════════════════════════
-- votos_reconocimiento: cero políticas. Solo la API, con la service key.
--
-- La migración anterior quitó las dos políticas que el repo conocía por nombre
-- ("Club members leen votos", "Club members votan") y quedaron tres que nunca
-- estuvieron escritas aquí, creadas desde el dashboard, las tres a {public}
-- (que incluye anon):
--
--   Admin full access on votos        ALL     {public}
--   Players can insert own votes      INSERT  {public}
--   Players can read own votes sent   SELECT  {public}
--
-- La de INSERT es la grave. Toda la validación de un voto vive en
-- /api/evaluaciones: que quien vota sea participante confirmado, que la
-- votación esté abierta, que no se vote a sí mismo, que el votado esté en el
-- partido, que la categoría exista, una respuesta por categoría. Con una
-- política de INSERT desde el cliente, nada de eso corre: un jugador escribe
-- directo en la tabla y se salta las seis. Y los votos dan reconocimientos, que
-- mueven el rating.
--
-- El UNIQUE (partido_id, votante_id, categoria) limita el daño a un voto por
-- categoría, pero no impide votarse a sí mismo, votar en un partido que no se
-- jugó, ni votar con la votación cerrada.
--
-- Ninguna de las tres hace falta: las siete lecturas/escrituras de esta tabla
-- salen de /api/evaluaciones con la service key, que se salta RLS. Con RLS
-- activo y sin políticas, la tabla queda cerrada a todo lo que no sea la API.
--
-- Se borran por barrido y no por nombre, que es justo el error que hizo falta
-- corregir dos veces: lo que no está en el repo no se puede quitar por nombre.
-- ════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'votos_reconocimiento'
  LOOP
    RAISE NOTICE 'Quitando política sobre votos_reconocimiento: %', r.policyname;
    EXECUTE format('DROP POLICY %I ON public.votos_reconocimiento', r.policyname);
  END LOOP;
END $$;

-- RLS tiene que seguir encendido: sin políticas Y sin RLS, la tabla queda
-- abierta de par en par.
ALTER TABLE public.votos_reconocimiento ENABLE ROW LEVEL SECURITY;

-- Debe devolver 0 filas.
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'votos_reconocimiento';
