-- ════════════════════════════════════════════════════════════════════════════
-- ¿ALCANZAN LOS DATOS PARA UN HISTORIAL CON FILTROS?
--
-- No es una migración. No cambia nada. Se corre antes de construir la pantalla
-- nueva, para saber cuáles filtros van a devolver algo de verdad y cuáles se
-- verían vacíos la mitad de las veces.
--
-- El supuesto que hay que comprobar: "partidos que X ganó" solo se puede saber
-- si quedó guardado EN QUÉ EQUIPO jugó X (tabla `equipo_jugadores`) y el
-- partido tiene marcador. En los partidos donde no se guardaron equipos, el
-- motor de rating no pudo decidir nada y dejó el evento sin 'ganó'/'perdió'.
-- Si eso pasa en la mayoría del historial, el filtro de ganados/perdidos hay
-- que presentarlo distinto (o solo desde la fecha en que haya cobertura).
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. El panorama: cuánto historial hay y desde cuándo ────────────────────
SELECT
  count(*)                                        AS partidos,
  count(*) FILTER (WHERE jugado IS NOT FALSE)     AS jugados,
  min(fecha)                                      AS primero,
  max(fecha)                                      AS ultimo,
  count(*) FILTER (WHERE foto_url IS NOT NULL)    AS con_foto,
  count(*) FILTER (WHERE goles_a IS NOT NULL
                      OR puntos_blanco IS NOT NULL) AS con_marcador
FROM public.partidos;


-- ── 2. LA PREGUNTA CLAVE: ¿cuántos partidos tienen equipos guardados? ──────
-- `con_equipos` es el techo real del filtro ganó/perdió.
WITH p AS (
  SELECT p.id, p.fecha,
         EXISTS (SELECT 1 FROM public.equipos e WHERE e.partido_id = p.id) AS tiene_equipos,
         EXISTS (SELECT 1 FROM public.equipos e
                 JOIN public.equipo_jugadores ej ON ej.equipo_id = e.id
                 WHERE e.partido_id = p.id)                                AS tiene_jugadores,
         (p.goles_a IS NOT NULL OR p.puntos_blanco IS NOT NULL)            AS tiene_marcador
  FROM public.partidos p
  WHERE p.jugado IS NOT FALSE
)
SELECT
  count(*)                                                         AS jugados,
  count(*) FILTER (WHERE tiene_equipos)                            AS con_equipos,
  count(*) FILTER (WHERE tiene_jugadores)                          AS con_jugadores_en_equipo,
  count(*) FILTER (WHERE tiene_jugadores AND tiene_marcador)       AS se_puede_saber_quien_gano,
  round(100.0 * count(*) FILTER (WHERE tiene_jugadores AND tiene_marcador)
        / NULLIF(count(*), 0), 1)                                  AS pct_utilizable
FROM p;


-- ── 3. ¿Desde cuándo hay cobertura? (por mes) ──────────────────────────────
-- Si la cobertura arranca en cierto mes, el filtro puede anunciarse desde ahí
-- en vez de mentir con ceros para los partidos viejos.
WITH p AS (
  SELECT p.fecha,
         EXISTS (SELECT 1 FROM public.equipos e
                 JOIN public.equipo_jugadores ej ON ej.equipo_id = e.id
                 WHERE e.partido_id = p.id)
         AND (p.goles_a IS NOT NULL OR p.puntos_blanco IS NOT NULL) AS utilizable
  FROM public.partidos p WHERE p.jugado IS NOT FALSE
)
SELECT date_trunc('month', fecha)::date AS mes,
       count(*)                          AS partidos,
       count(*) FILTER (WHERE utilizable) AS con_ganador_por_jugador
FROM p GROUP BY 1 ORDER BY 1 DESC LIMIT 18;


-- ── 4. El ledger: ¿cubre el historial, y qué motivos trae? ─────────────────
-- Esta es la tabla que alimentaría los filtros. Cada fila es un jugador en un
-- partido. Si 'ganó'/'perdió' son pocos frente a 'jugó', es por lo de arriba.
SELECT
  motivo,
  count(*) AS veces
FROM public.rating_events, LATERAL jsonb_array_elements_text(motivos) AS motivo
GROUP BY motivo ORDER BY veces DESC;


-- ── 5. Partidos jugados SIN fila en el ledger ──────────────────────────────
-- Un partido sin eventos no aparecería en un historial construido sobre
-- rating_events. Debería dar 0 o casi: son los que no tienen marcador o
-- tienen las votaciones abiertas todavía.
SELECT p.fecha, p.dia_semana,
       (p.goles_a IS NOT NULL OR p.puntos_blanco IS NOT NULL) AS tiene_marcador,
       p.evaluaciones_abiertas
FROM public.partidos p
WHERE p.jugado IS NOT FALSE
  AND NOT EXISTS (SELECT 1 FROM public.rating_events r WHERE r.partido_id = p.id)
ORDER BY p.fecha DESC LIMIT 30;


-- ── 6. Cómo se vería la ficha de un jugador ────────────────────────────────
-- Esto es exactamente lo que muestra la cabecera de /historial al filtrar por
-- una persona, y tiene que dar EL MISMO número que la app.
--
-- OJO con el denominador. La primera versión de esta consulta dividía entre
-- los JUGADOS y la app divide entre los DECIDIDOS, así que danielb3 salía con
-- 50.0% aquí y 58.3% en pantalla. Es el porcentaje sobre los partidos de los
-- que se sabe el resultado: los que no tienen equipos guardados no se pueden
-- contar como derrota, y meterlos en el denominador baja el número de todos
-- sin que nadie haya perdido nada. Si se cambia aquí, cambiar también
-- `fichaDeEventos` en src/lib/historial.ts, o vuelven a discrepar.
SELECT
  pr.username,
  count(*) FILTER (WHERE r.motivos ? 'jugó')    AS jugados,
  count(*) FILTER (WHERE r.motivos ? 'ganó')    AS ganados,
  count(*) FILTER (WHERE r.motivos ? 'perdió')  AS perdidos,
  count(*) FILTER (WHERE r.motivos ? 'empató')  AS empatados,
  -- Jugó, pero sin equipos guardados: no se puede saber si ganó.
  count(*) FILTER (WHERE r.motivos ? 'jugó'
                     AND NOT (r.motivos ? 'ganó')
                     AND NOT (r.motivos ? 'perdió')
                     AND NOT (r.motivos ? 'empató'))  AS sin_datos,
  round(100.0 * count(*) FILTER (WHERE r.motivos ? 'ganó')
        / NULLIF(count(*) FILTER (WHERE r.motivos ? 'ganó'
                                    OR r.motivos ? 'perdió'
                                    OR r.motivos ? 'empató'), 0), 1) AS pct_victorias
FROM public.rating_events r
JOIN public.profiles pr ON pr.id = r.player_id
GROUP BY pr.username
HAVING count(*) FILTER (WHERE r.motivos ? 'jugó') > 0
ORDER BY jugados DESC
LIMIT 25;
