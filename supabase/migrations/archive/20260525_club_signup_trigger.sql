-- ═══════════════════════════════════════════════════════════════════════════
-- Profile creation trigger — club-aware
-- Creates profile row when user signs up via Supabase Auth.
-- Reads club_id from user metadata (set by registro page via /api/club).
-- Falls back to MBA FC club if missing (safety net for existing flows).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_club_id uuid;
BEGIN
  -- Read club_id from auth metadata; fall back to MBA FC
  v_club_id := COALESCE(
    (new.raw_user_meta_data->>'club_id')::uuid,
    'a0000000-0000-0000-0000-000000000001'::uuid
  );

  INSERT INTO public.profiles (
    id,
    email,
    username,
    ip_registro,
    club_id,
    role,
    aprobado
  ) VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'ip_registro',
    v_club_id,
    'player',
    false
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$;

-- Drop existing trigger if present, recreate cleanly
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
