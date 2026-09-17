-- ════════════════════════════════════════════════════════════════════════════
-- Reconocimientos: quitar uno y que se quede quitado.
--
-- Los badges se recalculan enteros cada vez que se cuenta la votación
-- (tallyAndAssign borra los del partido y los vuelve a insertar). Ese re-conteo
-- corre desde tres lados: el cierre manual del admin, el auto-cierre cuando
-- vota el último jugador, y el cron. Sin esta tabla, un reconocimiento que el
-- admin quita por "lo votaron de chiste" reaparece en el siguiente conteo.
--
-- Una fila aquí es una veto permanente: el conteo salta a ese jugador en esa
-- categoría de ese partido. Reabrir la votación limpia los vetos del partido,
-- porque reabrir ya es empezar de cero (borra todos los badges del partido).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.badges_revocados (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid        NOT NULL REFERENCES public.clubs(id),
  partido_id   uuid        NOT NULL REFERENCES public.partidos ON DELETE CASCADE,
  player_id    uuid        NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  badge_id     text        NOT NULL,
  motivo       text,
  revocado_por uuid        REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT badges_revocados_unique UNIQUE (partido_id, player_id, badge_id)
);

ALTER TABLE public.badges_revocados ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_badges_revocados_partido
  ON public.badges_revocados(partido_id);

-- Solo lectura desde el cliente y solo del propio club; escribe únicamente la
-- API con la service key. Misma forma que votos_reconocimiento y
-- equipo_jugadores: un FOR ALL dejaría a un miembro revocarle el badge a otro.
DROP POLICY IF EXISTS "Club members leen revocados" ON public.badges_revocados;
CREATE POLICY "Club members leen revocados"
  ON public.badges_revocados FOR SELECT TO authenticated
  USING (club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()));

-- Verificar con la llave anon y sin sesión: debe devolver 0 filas.
