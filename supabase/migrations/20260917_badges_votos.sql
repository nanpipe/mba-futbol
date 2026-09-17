-- ════════════════════════════════════════════════════════════════════════════
-- Cuántos votos sacó cada reconocimiento, guardado junto al reconocimiento.
--
-- La tarjeta de resultados (home e /historial) lee player_badges directo desde
-- el navegador y no mostraba el conteo. La salida fácil era que el cliente
-- leyera votos_reconocimiento y contara — y eso rompe el anonimato: las filas
-- traen votante_id, así que cualquiera con la consola abierta vería quién votó
-- a quién. El conteo se guarda aquí al cerrar la votación y el cliente nunca
-- ve un voto.
--
-- Por lo mismo se va la política que dejaba leer los votos desde el cliente:
-- ningún componente la usa (toda la lectura pasa por la service key en
-- /api/evaluaciones) y mientras existiera, "es anónimo" era mentira.
--
-- ── Sobre los bloqueos ──────────────────────────────────────────────────────
-- Corriendo los tres pasos juntos esto dio un deadlock contra la app viva: el
-- script toma lock exclusivo sobre player_badges y después lee
-- votos_reconocimiento, mientras una sesión de la app hacía lo contrario.
--
-- Por eso van SEPARADOS y en este orden. Cada paso es corto e idempotente, así
-- que si uno falla se vuelve a correr solo ese. lock_timeout convierte una
-- espera larga en un error limpio en vez de dejar la tabla trancada.
-- Si vuelve a chocar, córrelos de a uno, o con poco tráfico.
-- ════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ── PASO 1: la columna ──────────────────────────────────────────────────────
-- Metadato nada más (sin DEFAULT no reescribe la tabla): toma el lock exclusivo
-- un instante y lo suelta.
ALTER TABLE public.player_badges
  ADD COLUMN IF NOT EXISTS votos integer;

COMMENT ON COLUMN public.player_badges.votos IS
  'Votos con los que se ganó, al momento del conteo. NULL = reconocimiento anterior a esta columna.';


-- ── PASO 2: rellenar los que ya estaban ─────────────────────────────────────
-- Los votos siguen en votos_reconocimiento, así que los partidos viejos también
-- muestran su conteo. Solo toca filas con votos IS NULL: re-correrlo no repite
-- trabajo ni pisa lo que ya escribió el conteo nuevo.
UPDATE public.player_badges pb
SET votos = sub.n
FROM (
  SELECT partido_id, categoria, votado_id, count(*) AS n
  FROM public.votos_reconocimiento
  WHERE votado_id IS NOT NULL
  GROUP BY partido_id, categoria, votado_id
) sub
WHERE pb.votos IS NULL
  AND pb.partido_id = sub.partido_id
  AND pb.badge_id   = sub.categoria
  AND pb.player_id  = sub.votado_id;


-- ── PASO 3: cerrar la lectura de votos desde el cliente ─────────────────────
-- Los votos son anónimos: solo la API los lee, con la service key, que se salta
-- RLS. Sin política de SELECT, nadie los alcanza desde el navegador.
DROP POLICY IF EXISTS "Club members leen votos" ON public.votos_reconocimiento;
DROP POLICY IF EXISTS "Club members votan"      ON public.votos_reconocimiento;


-- ── Verificación ────────────────────────────────────────────────────────────
-- con_conteo debe ser > 0 si hay reconocimientos con votos guardados.
SELECT count(*) FILTER (WHERE votos IS NOT NULL) AS con_conteo,
       count(*)                                  AS total
FROM public.player_badges;

-- No debe quedar ninguna política sobre votos_reconocimiento.
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'votos_reconocimiento';

-- Y con una sesión de jugador normal (no service key), esto debe dar 0:
--   SELECT count(*) FROM public.votos_reconocimiento;
