-- Add unique constraint required for upsert onConflict to work correctly.
-- Without this, upsert silently fails (no constraint to match ON CONFLICT).
ALTER TABLE public.player_badges
  ADD CONSTRAINT player_badges_unique_player_badge_partido
  UNIQUE (player_id, badge_id, partido_id);
