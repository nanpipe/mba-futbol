-- ════════════════════════════════════════════════════════════════════════════
-- Ausencia: an admin marks a player away (trip, injury) for a date range.
--
-- While absent the player doesn't lose rating for not signing up, doesn't get
-- "inscripciones abiertas" / "cupos" nudges, and cannot sign up on their own.
-- A match they do play (an admin added them) counts in full.
--
-- Set only through /api/admin (service role). Clients have no UPDATE policy on
-- profiles since 20260917_quitar_escrituras_de_cliente.sql, so a player can't
-- mark themselves absent to shield their rating.
--
-- ausente_desde is the day it was marked: recomputing an older match never
-- applies an absence retroactively.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ausente_desde date,
  ADD COLUMN IF NOT EXISTS ausente_hasta date;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_ausencia_rango;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_ausencia_rango
  CHECK (
    (ausente_desde IS NULL AND ausente_hasta IS NULL)
    OR (ausente_desde IS NOT NULL AND ausente_hasta IS NOT NULL AND ausente_desde <= ausente_hasta)
  );

-- Check: both columns exist.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name LIKE 'ausente_%';
