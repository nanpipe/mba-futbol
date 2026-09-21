-- ════════════════════════════════════════════════════════════════════════════
-- ¿CUÁNTO PESA LA APP, Y QUÉ ES LO QUE PESA?
--
-- No es una migración. No cambia nada. Se corre a mano en el SQL editor cuando
-- se quiera saber si el plan gratis de Supabase aguanta, y sobre todo QUÉ es lo
-- que lo va a reventar primero.
--
-- La intuición normal es "los datos se acumulan y hay que borrar historia cada
-- año". Para esta app eso es casi seguro falso: las filas son chicas y son
-- pocas. Lo que pesa son las FOTOS. Este script lo mide en vez de suponerlo.
--
-- Los límites del plan gratis (confirmar en el dashboard, cambian con el tiempo):
--   · Base de datos      500 MB
--   · Storage (archivos)   1 GB
--   · Egress (descarga)    5 GB al mes   ← el que nadie mira y el que primero duele
--   · El proyecto se PAUSA tras 7 días sin actividad
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. Peso total de la base, tabla por tabla ───────────────────────────────
-- 'total' incluye índices, que en tablas de puros uuid pesan más que los datos.
SELECT
  relname AS tabla,
  to_char(n_live_tup, 'FM999,999,999')             AS filas,
  pg_size_pretty(pg_total_relation_size(relid))    AS total,
  pg_size_pretty(pg_relation_size(relid))          AS solo_datos,
  pg_size_pretty(pg_indexes_size(relid))           AS indices
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(relid) DESC;


-- ── 2. El número que importa: ¿cuánto falta para los 500 MB? ────────────────
SELECT
  pg_size_pretty(pg_database_size(current_database()))                      AS base_hoy,
  pg_size_pretty(500 * 1024 * 1024 - pg_database_size(current_database()))  AS libre,
  round(100.0 * pg_database_size(current_database()) / (500 * 1024 * 1024), 1) AS pct_usado;


-- ── 3. ¿A qué ritmo crece? (filas por año de lo que más se acumula) ─────────
-- Si el total de la columna "al_ano" se multiplica por ~250 bytes y da menos de
-- 50 MB, la base NO es el problema y borrar historia no resuelve nada.
WITH rango AS (
  SELECT
    GREATEST(1, EXTRACT(DAY FROM (max(fecha)::timestamp - min(fecha)::timestamp))) AS dias,
    count(*) AS partidos
  FROM public.partidos WHERE jugado IS NOT FALSE
)
SELECT t.tabla, t.filas,
       round(t.filas / (SELECT dias FROM rango) * 365)::bigint AS al_ano,
       pg_size_pretty((round(t.filas / (SELECT dias FROM rango) * 365) * 250)::bigint) AS mb_al_ano_aprox
FROM (
  SELECT 'votos_reconocimiento' AS tabla, count(*)::numeric AS filas FROM public.votos_reconocimiento
  UNION ALL SELECT 'player_thumbs',  count(*) FROM public.player_thumbs
  UNION ALL SELECT 'inscripciones',  count(*) FROM public.inscripciones
  UNION ALL SELECT 'rating_events',  count(*) FROM public.rating_events
  UNION ALL SELECT 'player_badges',  count(*) FROM public.player_badges
  UNION ALL SELECT 'activity_log',   count(*) FROM public.activity_log
) t
ORDER BY t.filas DESC;


-- ── 4. activity_log: el único que crece sin que nadie lo mire ───────────────
-- Hay 87 lugares en el código que escriben aquí y NADA que borre. No es urgente
-- (son filas chicas), pero es la única tabla que crece por uso y no por partidos.
SELECT
  date_trunc('month', created_at)::date AS mes,
  count(*)                              AS eventos
FROM public.activity_log
GROUP BY 1 ORDER BY 1 DESC LIMIT 12;


-- ── 5. LAS FOTOS. Esto es lo que de verdad llena el plan gratis ─────────────
SELECT
  bucket_id                                                    AS bucket,
  count(*)                                                     AS archivos,
  pg_size_pretty(sum((metadata->>'size')::bigint))             AS peso_total,
  pg_size_pretty(avg((metadata->>'size')::bigint)::bigint)     AS peso_promedio,
  pg_size_pretty(max((metadata->>'size')::bigint))             AS el_mas_grande,
  round(100.0 * sum((metadata->>'size')::bigint) / (1024^3), 1) AS pct_del_giga
FROM storage.objects
GROUP BY bucket_id
ORDER BY sum((metadata->>'size')::bigint) DESC;


-- ── 6. Fotos huérfanas: subidas, pagadas, y que nadie ve ────────────────────
-- El nombre lleva timestamp (`foto-1737400000000.jpg`), así que volver a subir
-- la foto de un partido NO reemplaza la anterior: crea otra y la vieja queda
-- ocupando espacio para siempre. Nada la borra, ni siquiera borrar el partido.
-- Si esto devuelve filas, es espacio que se está pagando por nada.
SELECT
  o.name                                          AS archivo,
  pg_size_pretty((o.metadata->>'size')::bigint)   AS peso,
  o.created_at::date                              AS subida
FROM storage.objects o
WHERE o.bucket_id = 'match-photos'
  AND NOT EXISTS (
    SELECT 1 FROM public.partidos p
    WHERE p.foto_url LIKE '%' || o.name
  )
ORDER BY (o.metadata->>'size')::bigint DESC;

-- Y el total de lo desperdiciado:
SELECT
  count(*)                                         AS fotos_huerfanas,
  pg_size_pretty(COALESCE(sum((o.metadata->>'size')::bigint), 0)) AS espacio_perdido
FROM storage.objects o
WHERE o.bucket_id = 'match-photos'
  AND NOT EXISTS (
    SELECT 1 FROM public.partidos p WHERE p.foto_url LIKE '%' || o.name
  );


-- ── 7. Cuántos años quedan, al ritmo actual ─────────────────────────────────
-- Divide el espacio libre entre lo que se sube por día. Si da menos de 3 años,
-- comprimir las fotos al subirlas lo multiplica por ~10 y el tema se cierra.
WITH fotos AS (
  SELECT
    sum((metadata->>'size')::bigint)                                   AS bytes,
    GREATEST(1, EXTRACT(DAY FROM (now() - min(created_at))))           AS dias
  FROM storage.objects WHERE bucket_id = 'match-photos'
)
SELECT
  pg_size_pretty(bytes)                                                AS fotos_hoy,
  pg_size_pretty((bytes / dias * 365)::bigint)                         AS al_ano,
  round((1024.0^3 - bytes) / NULLIF(bytes / dias * 365, 0), 1)         AS anos_restantes
FROM fotos;
