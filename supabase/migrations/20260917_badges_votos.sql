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
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.player_badges
  ADD COLUMN IF NOT EXISTS votos integer;

COMMENT ON COLUMN public.player_badges.votos IS
  'Votos con los que se ganó, al momento del conteo. NULL = reconocimiento anterior a esta columna.';

-- Rellenar los que ya estaban: los votos siguen en votos_reconocimiento, así
-- que los partidos viejos también muestran su conteo.
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

-- Los votos son anónimos: solo la API los lee, con la service key, que se salta
-- RLS. Sin política de SELECT, nadie los alcanza desde el navegador.
DROP POLICY IF EXISTS "Club members leen votos" ON public.votos_reconocimiento;
DROP POLICY IF EXISTS "Club members votan"      ON public.votos_reconocimiento;

-- Verificar: con una sesión normal de jugador, esto debe devolver 0 filas.
--   SELECT count(*) FROM public.votos_reconocimiento;
SELECT count(*) FILTER (WHERE votos IS NOT NULL) AS con_conteo,
       count(*)                                  AS total
FROM public.player_badges;
