-- ════════════════════════════════════════════════════════════════════════════
-- Auditoría del balanceador de equipos — SOLO LECTURA
-- ════════════════════════════════════════════════════════════════════════════
-- No es una migración. No escribe nada: se puede correr las veces que se quiera.
-- Correr cada bloque por separado en el SQL editor de Supabase.
--
-- Para qué sirve: decidir cómo arreglar el balanceador con NÚMEROS y no con la
-- impresión de la cancha. El mejor juez de si dos equipos estaban parejos no es
-- el promedio de estrellas que muestra la pantalla: es el marcador. Si el
-- balanceador funciona, los partidos terminan cerrados.


-- ── 1. Partido por partido ──────────────────────────────────────────────────
-- De dónde salieron los equipos, cuántas veces los re-guardó un admin, cómo
-- terminó el partido y qué votaron los jugadores sobre la alineación.
--
--   origen:
--     auto intacto  → el borrador automático de la hora promo, sin tocar
--     auto editado  → hubo borrador automático y un admin lo cambió
--     manual        → no hubo borrador automático; lo armó un admin
--   motor: gemini | fallback (snake draft) — solo se sabe para el automático
WITH auto AS (
  SELECT detalles->>'partido_id' AS partido_id,
         max(detalles->>'source')  AS motor
  FROM public.activity_log
  WHERE accion = 'auto_borrador_equipos'
  GROUP BY 1
),
guardados AS (
  SELECT detalles->>'partido_id' AS partido_id, count(*) AS veces
  FROM public.activity_log
  WHERE accion = 'guardar_equipos'
  GROUP BY 1
),
votos AS (
  SELECT partido_id::text AS partido_id,
         count(*) FILTER (WHERE voto =  1) AS parejo,
         count(*) FILTER (WHERE voto = -1) AS disparejo
  FROM public.alineacion_votos
  GROUP BY 1
)
SELECT
  p.fecha,
  p.dia_semana,
  CASE
    WHEN a.partido_id IS NOT NULL AND coalesce(g.veces, 0) = 0 THEN 'auto intacto'
    WHEN a.partido_id IS NOT NULL                              THEN 'auto editado'
    WHEN coalesce(g.veces, 0) > 0                              THEN 'manual'
    ELSE 'sin datos'
  END                                   AS origen,
  a.motor,
  coalesce(g.veces, 0)                  AS veces_reguardado,
  p.goles_a || ' - ' || p.goles_b       AS marcador,
  abs(p.goles_a - p.goles_b)            AS diferencia_goles,
  coalesce(v.parejo, 0)                 AS votos_parejo,
  coalesce(v.disparejo, 0)              AS votos_disparejo
FROM public.partidos p
LEFT JOIN auto      a ON a.partido_id = p.id::text
LEFT JOIN guardados g ON g.partido_id = p.id::text
LEFT JOIN votos     v ON v.partido_id = p.id::text
WHERE p.tipo IS DISTINCT FROM 'minitorneo'
  AND p.jugado IS NOT FALSE
  AND p.goles_a IS NOT NULL AND p.goles_b IS NOT NULL
ORDER BY p.fecha DESC
LIMIT 30;


-- ── 2. Resumen por origen ───────────────────────────────────────────────────
-- La pregunta de fondo: ¿el automático sale peor que lo que arma un admin?
-- Una diferencia de goles promedio más alta = equipos menos parejos.
WITH auto AS (
  SELECT detalles->>'partido_id' AS partido_id, max(detalles->>'source') AS motor
  FROM public.activity_log WHERE accion = 'auto_borrador_equipos' GROUP BY 1
),
guardados AS (
  SELECT detalles->>'partido_id' AS partido_id, count(*) AS veces
  FROM public.activity_log WHERE accion = 'guardar_equipos' GROUP BY 1
),
votos AS (
  SELECT partido_id::text AS partido_id,
         count(*) FILTER (WHERE voto =  1) AS parejo,
         count(*) FILTER (WHERE voto = -1) AS disparejo
  FROM public.alineacion_votos GROUP BY 1
),
por_partido AS (
  SELECT
    CASE
      WHEN a.partido_id IS NOT NULL AND coalesce(g.veces, 0) = 0 THEN 'auto intacto'
      WHEN a.partido_id IS NOT NULL                              THEN 'auto editado'
      WHEN coalesce(g.veces, 0) > 0                              THEN 'manual'
      ELSE 'sin datos'
    END AS origen,
    abs(p.goles_a - p.goles_b)  AS dif,
    coalesce(v.parejo, 0)       AS parejo,
    coalesce(v.disparejo, 0)    AS disparejo
  FROM public.partidos p
  LEFT JOIN auto      a ON a.partido_id = p.id::text
  LEFT JOIN guardados g ON g.partido_id = p.id::text
  LEFT JOIN votos     v ON v.partido_id = p.id::text
  WHERE p.tipo IS DISTINCT FROM 'minitorneo'
    AND p.jugado IS NOT FALSE
    AND p.goles_a IS NOT NULL AND p.goles_b IS NOT NULL
)
SELECT
  origen,
  count(*)                                              AS partidos,
  round(avg(dif)::numeric, 1)                           AS dif_goles_promedio,
  count(*) FILTER (WHERE dif <= 2)                      AS partidos_cerrados,
  count(*) FILTER (WHERE dif >= 5)                      AS goleadas,
  sum(parejo)                                           AS votos_parejo,
  sum(disparejo)                                        AS votos_disparejo,
  CASE WHEN sum(parejo) + sum(disparejo) > 0
       THEN round(100.0 * sum(parejo) / (sum(parejo) + sum(disparejo)), 0)
  END                                                   AS pct_parejo
FROM por_partido
GROUP BY origen
ORDER BY partidos DESC;


-- ── 3. Lo que dijeron los jugadores de la alineación ────────────────────────
-- Los comentarios dicen QUÉ les pareció mal, cosa que ningún número dice.
SELECT p.fecha, pr.username, av.voto, av.comentario
FROM public.alineacion_votos av
JOIN public.partidos p  ON p.id = av.partido_id
JOIN public.profiles pr ON pr.id = av.player_id
WHERE av.comentario IS NOT NULL AND btrim(av.comentario) <> ''
ORDER BY p.fecha DESC, av.created_at DESC
LIMIT 40;


-- ── 4. ¿El rating ya distingue a la gente? ──────────────────────────────────
-- El 12-sep, 23 de 38 estaban clavados en 3.00. Si sigue así, ningún
-- balanceador puede funcionar: está repartiendo gente que para él es idéntica.
SELECT
  count(*)                                                        AS jugadores,
  round(min(habilidad)::numeric, 2)                               AS minimo,
  round(percentile_cont(0.25) WITHIN GROUP (ORDER BY habilidad)::numeric, 2) AS p25,
  round(percentile_cont(0.50) WITHIN GROUP (ORDER BY habilidad)::numeric, 2) AS mediana,
  round(percentile_cont(0.75) WITHIN GROUP (ORDER BY habilidad)::numeric, 2) AS p75,
  round(max(habilidad)::numeric, 2)                               AS maximo,
  round(stddev_pop(habilidad)::numeric, 3)                        AS desviacion,
  count(*) FILTER (WHERE habilidad = 3.0)                         AS clavados_en_3
FROM public.profiles
WHERE aprobado AND NOT baneado;


-- ── 5. Las reglas que escribió el admin ─────────────────────────────────────
-- Se le pasan a Gemini tal cual. El 12-sep usaban apodos ("Melo") que no
-- coinciden con los usernames ("melo8"), y reglas como "separar Melo y Alexis"
-- se ignoraban. Mirar si siguen así.
SELECT created_at::date AS fecha, feedback
FROM public.balancer_feedback
ORDER BY created_at DESC;


-- ── 6. Cuántos jugadores tienen posición cargada ────────────────────────────
-- Sin posiciones, "un portero por lado" o "no juntar tres delanteros" no se
-- pueden cumplir.
SELECT
  coalesce(nullif(posicion, ''), '(vacía)') AS posicion,
  count(*)                                   AS jugadores
FROM public.profiles
WHERE aprobado AND NOT baneado
GROUP BY 1
ORDER BY 2 DESC;
