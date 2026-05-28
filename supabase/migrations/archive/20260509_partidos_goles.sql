-- Add structured score columns to partidos
-- resultado (text) stays for display; goles_a/goles_b enable per-player yearly stats
ALTER TABLE public.partidos
  ADD COLUMN IF NOT EXISTS goles_a integer,
  ADD COLUMN IF NOT EXISTS goles_b integer;
