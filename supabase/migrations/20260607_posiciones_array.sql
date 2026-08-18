-- ════════════════════════════════════════════════════════════════════════════
-- Allow up to 2 positions per player. Adds posiciones text[]; backfills from the
-- existing single `posicion`. `posicion` stays = posiciones[0] for back-compat.
-- Run once in Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS posiciones text[] NOT NULL DEFAULT '{}';

-- Backfill: copy current single posicion into the array (skip 'cualquiera'/null)
UPDATE public.profiles
SET posiciones = ARRAY[posicion]
WHERE (posiciones = '{}' OR posiciones IS NULL)
  AND posicion IS NOT NULL
  AND posicion <> 'cualquiera';
