-- ════════════════════════════════════════════════════════════════════════════
-- Storage: anonymous callers can still LIST avatars and match-photos.
--
-- Verified 2026-09-12 with the anon key: both buckets list files, uploads are
-- refused. 20260907_storage_policies.sql only drops its own `mbafc_*` policies,
-- so a SELECT policy created earlier from the dashboard (typically named like
-- "Public Access") is still OR'd in and keeps listing open.
--
-- Public buckets serve files via /storage/v1/object/public/..., which ignores
-- these policies — avatars and match photos keep displaying.
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Signed-in users keep listing (avatar upsert needs SELECT on its own file).
DROP POLICY IF EXISTS "mbafc_avatars_list_autenticados" ON storage.objects;
CREATE POLICY "mbafc_avatars_list_autenticados"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "mbafc_fotos_list_autenticados" ON storage.objects;
CREATE POLICY "mbafc_fotos_list_autenticados"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'match-photos');

-- 2. Drop every other SELECT policy that reaches anon (directly or via PUBLIC)
--    and covers these buckets. Only SELECT — write policies are left alone.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND cmd = 'SELECT'
      AND policyname NOT LIKE 'mbafc_%'
      AND roles && ARRAY['public', 'anon']::name[]
      AND (qual ILIKE '%avatars%' OR qual ILIKE '%match-photos%' OR qual IS NULL OR qual = 'true')
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

-- 3. What's left. Expect only authenticated/service rows for these buckets.
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY cmd, policyname;
