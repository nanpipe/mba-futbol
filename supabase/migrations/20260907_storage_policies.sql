-- ════════════════════════════════════════════════════════════════════════════
-- Storage policies, written down instead of living only in the dashboard.
--
-- Verified against production: `avatars` and `match-photos` are public buckets,
-- and an anonymous caller can LIST `avatars` — the folder names are user UUIDs,
-- so the whole member list is enumerable. Whether a member can overwrite
-- somebody else's avatar was impossible to tell, because no storage policy was
-- ever committed to this repo.
--
-- Public buckets serve files through /storage/v1/object/public/..., which does
-- not consult these policies, so tightening SELECT does not break displaying
-- avatars or match photos.
-- Run once in the Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════════════

-- Start from a clean slate for these two buckets so re-running is safe.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname LIKE 'mbafc_%'
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

-- ── avatars ────────────────────────────────────────────────────────────────
-- The browser uploads straight to `${auth.uid()}/avatar.png` (perfil page), so
-- writes are allowed only inside the caller's own folder. Without this, any
-- member could upload to another player's path and replace their photo.
CREATE POLICY "mbafc_avatars_insert_propio"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "mbafc_avatars_update_propio"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "mbafc_avatars_delete_propio"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Listing is what leaks the member ids. Signed-in users keep it; anonymous
-- callers lose it. Public file URLs are unaffected.
CREATE POLICY "mbafc_avatars_list_autenticados"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');

-- ── match-photos ───────────────────────────────────────────────────────────
-- Uploaded only by /api/admin/foto with the service role, which bypasses RLS.
-- No client write policy on purpose; listing stays behind a session.
CREATE POLICY "mbafc_fotos_list_autenticados"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'match-photos');

-- Afterwards, confirm with the anon key that listing `avatars` returns nothing
-- while an avatar's public URL still loads.
