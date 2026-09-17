-- ════════════════════════════════════════════════════════════════════════════
-- Storage: quitar las políticas viejas del dashboard que duplican a las mbafc_.
--
-- El listado anónimo quedó cerrado (2026-09-17: ninguna política SELECT llega a
-- anon ni a public). Pero al revisar quedaron seis políticas de escritura donde
-- deberían ir tres, en dos generaciones:
--
--   avatars INSERT → "Users can upload own avatar"  {authenticated}
--                    "Users upload own avatar"      {public}      ← llega a anon
--                    mbafc_avatars_insert_propio    {authenticated}
--   avatars UPDATE → "Users can update own avatar"  {authenticated}
--                    "Users update own avatar"      {public}      ← llega a anon
--                    mbafc_avatars_update_propio    {authenticated}
--
-- Las políticas RLS se combinan con OR: manda la más floja, no la más estricta.
-- Mientras exista una versión concedida a PUBLIC, lo único que separa a un
-- anónimo del bucket es la expresión de ESA política, no la nuestra. Si su
-- WITH CHECK compara contra auth.uid() el anónimo no pasa (auth.uid() es NULL);
-- si es solo bucket_id = 'avatars', cualquiera sube archivos sin sesión. Que la
-- respuesta dependa de una política que nadie escribió en este repo es
-- exactamente cómo sobrevivió el listado anónimo hasta ahora.
--
-- Las mbafc_ ya cubren todo lo que la app hace de verdad:
--   · perfil sube a `${auth.uid()}/avatar.png` con upsert → insert + update propios
--   · las fotos de partido las sube /api/admin/foto con la service key, que se
--     salta RLS por completo → ninguna política de cliente hace falta
--
-- Por eso "Admins can upload match photos" también sale: no la usa nadie.
-- Las de bug screenshots se quedan — son de otro bucket, solo authenticated, y
-- no hay una línea en este repo que lo toque, así que no sé qué las consume.
-- Seguro de re-correr.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Users upload own avatar"     ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users update own avatar"     ON storage.objects;
DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload match photos" ON storage.objects;

-- Red de seguridad: si el dashboard vuelve a crear algo concedido a public/anon
-- sobre estos buckets, cae aquí. Solo toca avatars y match-photos, así que las
-- de bug screenshots no se ven afectadas.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname NOT LIKE 'mbafc_%'
      AND roles && ARRAY['public', 'anon']::name[]
      AND (qual ILIKE '%avatars%' OR qual ILIKE '%match-photos%'
           OR with_check ILIKE '%avatars%' OR with_check ILIKE '%match-photos%')
  LOOP
    RAISE NOTICE 'Quitando política abierta a anon: %', r.policyname;
    EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

-- Debe quedar exactamente esto sobre avatars y match-photos:
--   mbafc_avatars_insert_propio     INSERT  {authenticated}
--   mbafc_avatars_update_propio     UPDATE  {authenticated}
--   mbafc_avatars_delete_propio     DELETE  {authenticated}
--   mbafc_avatars_list_autenticados SELECT  {authenticated}
--   mbafc_fotos_list_autenticados   SELECT  {authenticated}
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY cmd, policyname;
