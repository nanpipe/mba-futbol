-- ════════════════════════════════════════════════════════════════════════════
-- "¿Se jugó el partido?" — an explicit answer instead of a side effect.
--
-- Until now "played" was inferred from equipos_confirmados (a team-builder flag)
-- and evaluaciones opened the day after regardless. The match now has its own
-- state, set one hour after kickoff:
--
--   jugado = NULL   → nobody has answered yet (admins see the question)
--   jugado = TRUE   → played: evaluaciones open, admins add score + photo
--   jugado = FALSE  → not played: nothing opens, ratings untouched
--
-- cierre_procesado is the cron's claim flag, so the kickoff+1h step (auto-mark
-- or ask the admins) runs exactly once per match.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.partidos
  ADD COLUMN IF NOT EXISTS jugado boolean,
  ADD COLUMN IF NOT EXISTS cierre_procesado boolean NOT NULL DEFAULT false;

-- Past matches: anything that shows signs of having been played is played.
UPDATE public.partidos
SET jugado = true
WHERE jugado IS NULL
  AND fecha < (now() AT TIME ZONE 'America/Bogota')::date
  AND (resultado IS NOT NULL OR evaluaciones_ya_abiertas OR equipos_confirmados);

-- Never ask about, or push for, matches that are already history.
UPDATE public.partidos
SET cierre_procesado = true
WHERE fecha < (now() AT TIME ZONE 'America/Bogota')::date;
