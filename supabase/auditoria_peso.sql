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
--
-- QUÉ ESPERAR. Estas consultas se probaron contra un Postgres 16 local con un
-- fixture de 3 años simulados (300 partidos, 2 por semana, 138 votos y 182
-- pulgares por partido, foto de 4 MB por partido). El resultado, a 3 años:
--
--   Base de datos ......  20 MB  →   4% de 500 MB   (~12 MB/año → décadas)
--   Storage ........... 1408 MB  → 137% de 1 GB     (YA SUPERADO)
--
-- O sea: la base no es el problema y borrar historia cada año no resuelve nada
-- (y rompería el recálculo de rating, que replaya toda la historia). Lo que
-- revienta el plan son las fotos, que hoy se suben SIN COMPRIMIR hasta 8 MB.
-- Si los números de abajo se parecen a estos, la solución es comprimir al
-- subir (÷15) y tapar la fuga de la consulta 6, no mudar la base a otro lado.
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
-- OJO con los tipos: `1024^3` es double precision (el operador ^ devuelve
-- float8), y round(double, int) NO EXISTE en Postgres — solo round(numeric,int).
-- Por eso todo lo que entre a round() va casteado a ::numeric a mano.
-- Las filas sin metadata (el .emptyFolderPlaceholder que deja Supabase) se
-- descartan: no son archivos de verdad.
SELECT
  bucket_id                                                        AS bucket,
  count(*)                                                         AS archivos,
  pg_size_pretty(sum((metadata->>'size')::bigint))                 AS peso_total,
  pg_size_pretty(avg((metadata->>'size')::bigint)::bigint)         AS peso_promedio,
  pg_size_pretty(max((metadata->>'size')::bigint))                 AS el_mas_grande,
  round(100.0 * sum((metadata->>'size')::bigint)::numeric
        / (1024::numeric * 1024 * 1024), 1)                        AS pct_del_giga
FROM storage.objects
WHERE metadata ? 'size'
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
  AND o.metadata ? 'size'          -- descarta el .emptyFolderPlaceholder
  AND NOT EXISTS (
    SELECT 1 FROM public.partidos p
    WHERE p.foto_url LIKE '%' || o.name
  )
ORDER BY (o.metadata->>'size')::bigint DESC;

-- Y el total de lo desperdiciado:
SELECT
  count(*)                                                        AS fotos_huerfanas,
  pg_size_pretty(COALESCE(sum((o.metadata->>'size')::bigint), 0)) AS espacio_perdido
FROM storage.objects o
WHERE o.bucket_id = 'match-photos'
  AND o.metadata ? 'size'
  AND NOT EXISTS (
    SELECT 1 FROM public.partidos p WHERE p.foto_url LIKE '%' || o.name
  );


-- ── 7. Cuántos años quedan, al ritmo actual ─────────────────────────────────
-- El espacio libre se calcula contra TODOS los buckets (el giga se comparte
-- entre fotos y avatares), pero el ritmo de crecimiento se mide solo sobre
-- match-photos: los avatares se sobrescriben, uno por jugador, y no crecen.
-- Si "anos_restantes" da menos de 3, comprimir al subir lo multiplica por ~15
-- y el tema se cierra por décadas.
WITH todo AS (
  SELECT COALESCE(sum((metadata->>'size')::bigint), 0)::numeric AS ocupado
  FROM storage.objects WHERE metadata ? 'size'
), fotos AS (
  SELECT
    COALESCE(sum((metadata->>'size')::bigint), 0)::numeric        AS bytes,
    GREATEST(1, (now()::date - min(created_at)::date))::numeric   AS dias
  FROM storage.objects WHERE bucket_id = 'match-photos' AND metadata ? 'size'
), calc AS (
  SELECT
    t.ocupado,
    (1024::numeric * 1024 * 1024) - t.ocupado AS libre,
    f.bytes / f.dias * 365                    AS por_ano
  FROM todo t, fotos f
)
SELECT
  pg_size_pretty(ocupado::bigint)                          AS storage_usado,
  round(100.0 * ocupado / (1024::numeric*1024*1024), 1)    AS pct_del_giga,
  pg_size_pretty(por_ano::bigint)                          AS fotos_al_ano,
  CASE
    WHEN libre <= 0       THEN 'YA SUPERADO — el plan gratis no alcanza'
    WHEN por_ano <= 0     THEN 'sin datos suficientes'
    ELSE round(libre / por_ano, 1)::text || ' años'
  END                                                      AS anos_restantes
FROM calc;
