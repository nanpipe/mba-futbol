-- ════════════════════════════════════════════════════════════════════════════
-- Quitar la función de reporte de bugs: quedó solo la plomería.
--
-- Hay tabla (bug_reports), tres políticas RLS y un bucket (bug-screenshots) con
-- dos políticas más. Lo que NO hay es una sola línea de aplicación que los use:
-- ni formulario para reportar, ni endpoint, ni pantalla para leerlos. Apareció
-- revisando las políticas de storage y el club confirmó que se puede quitar.
--
-- De paso se va un hueco multi-tenant: bug_reports no tiene club_id, así que
-- "Superadmin ve todos los bug reports" era literal — todos los clubes.
--
-- ⚠ Esto borra datos. La migración se niega a correr si la tabla tiene filas,
-- para no destruir reportes que alguien haya metido a mano. Si en ese caso
-- igual los quieres botar, sácalos primero (o cambia el RAISE por un TRUNCATE
-- a conciencia) y vuelve a correr.
--
-- ⚠ El bucket NO se borra desde aquí. Borrar filas de storage.objects con SQL
-- deja los archivos huérfanos en el almacenamiento. Para eliminarlo de verdad:
-- Supabase → Storage → bug-screenshots → Delete bucket.
-- Seguro de re-correr.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_filas    bigint := 0;
  v_archivos bigint := 0;
BEGIN
  IF to_regclass('public.bug_reports') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.bug_reports' INTO v_filas;
  END IF;

  SELECT count(*) INTO v_archivos
  FROM storage.objects WHERE bucket_id = 'bug-screenshots';

  RAISE NOTICE 'bug_reports: % filas · bug-screenshots: % archivos', v_filas, v_archivos;

  IF v_filas > 0 THEN
    RAISE EXCEPTION
      'bug_reports tiene % filas. Revísalas antes de borrar la tabla; nada se tocó.', v_filas;
  END IF;

  IF v_archivos > 0 THEN
    RAISE WARNING
      'Quedan % archivos en bug-screenshots. Las políticas se quitan igual, pero '
      'los archivos siguen ahí: bórralos desde Supabase → Storage → Delete bucket.',
      v_archivos;
  END IF;
END $$;

-- Políticas del bucket (creadas desde el dashboard, nunca estuvieron en el repo).
DROP POLICY IF EXISTS "Admins can read bug screenshots"                ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload bug screenshots" ON storage.objects;

-- La tabla se lleva sus tres políticas al caer. Un DROP POLICY suelto aquí
-- reventaría al re-correr la migración, porque IF EXISTS cubre la política pero
-- no la tabla que ya no está.
DROP TABLE IF EXISTS public.bug_reports;

-- No debe quedar ninguna fila.
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname ILIKE '%bug%';
