-- ════════════════════════════════════════════════════════════════════════════
-- profiles.habilidad was rounding every rating to ONE decimal on write.
--
-- Verified 2026-09-17 against production (read-only): rating_events keeps the
-- exact value (rating_after 2.98, 3.08, 3.12) but profiles.habilidad holds 3.0
-- and 3.1 for 34 of 38 players. The column in production has a scale of 1,
-- whatever schema_current.sql says.
--
-- It doesn't just hide decimals, it freezes the rating: 3.00 − 0.02 = 2.98 is
-- stored as 3.0, and the next match starts from 3.0 again. Any delta under
-- 0.05 is erased on save, so only capped matches ever moved anyone.
--
-- Fix: give the column three decimals, then rebuild every rating from the
-- ledger. Deltas never depend on the current rating (only the 1–5 clamp does),
-- so 3.0 + the running sum of a player's deltas is the exact value the app
-- meant to store. rating_after is rewritten too, so the ledger reads true.
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.profiles
  ALTER COLUMN habilidad TYPE numeric(4,3) USING habilidad::numeric(4,3);

ALTER TABLE public.rating_events
  ALTER COLUMN delta TYPE numeric(5,3) USING delta::numeric(5,3),
  ALTER COLUMN rating_after TYPE numeric(4,3) USING rating_after::numeric(4,3);

-- Running value per event, in the order the matches were applied.
UPDATE public.rating_events e
SET rating_after = LEAST(5, GREATEST(1, 3.0 + x.acumulado))
FROM (
  SELECT id, SUM(delta) OVER (PARTITION BY player_id ORDER BY created_at, id) AS acumulado
  FROM public.rating_events
) x
WHERE e.id = x.id;

-- Current rating = last running value. Players with no events keep theirs.
UPDATE public.profiles p
SET habilidad = LEAST(5, GREATEST(1, 3.0 + s.total))
FROM (
  SELECT player_id, SUM(delta) AS total
  FROM public.rating_events
  GROUP BY player_id
) s
WHERE p.id = s.player_id;

COMMIT;

-- Check: expect values like 2.760, 3.140 — not only multiples of 0.1.
SELECT username, habilidad
FROM public.profiles
WHERE aprobado
ORDER BY habilidad DESC;
