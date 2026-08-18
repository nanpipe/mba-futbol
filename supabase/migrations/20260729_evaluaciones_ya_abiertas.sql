-- ════════════════════════════════════════════════════════════════════════════
-- Fix: closing evaluaciones didn't stick — the cron kept re-opening them.
--
-- The cron (runs every minute) auto-opens evaluaciones for yesterday's match
-- whenever it finds them closed. That check was stateless, so it couldn't tell
-- "never opened yet" from "the admin just closed them on purpose" — within a
-- minute of closing, it opened them right back up.
--
-- This flag records that a match's evaluaciones have been opened once, so the
-- auto-open fires a single time and an admin's close is final.
-- Run once in the Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.partidos
  ADD COLUMN IF NOT EXISTS evaluaciones_ya_abiertas boolean NOT NULL DEFAULT false;

-- Backfill: every past match has already had its chance to open, so mark them
-- all. Without this the cron would re-open yesterday's match one last time.
UPDATE public.partidos
  SET evaluaciones_ya_abiertas = true
  WHERE fecha < CURRENT_DATE OR evaluaciones_abiertas = true;
