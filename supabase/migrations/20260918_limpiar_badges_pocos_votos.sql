-- ════════════════════════════════════════════════════════════════════════════
-- Borrar los reconocimientos ganados con 2 votos o menos.
--
-- El quórum vigente los deja pasar: se asigna si el ganador saca 5 votos en la
-- categoría O si votaron 8 personas, con un piso de 2. Ese "o" es el que deja
-- entrar a un ganador de 2 votos en un partido concurrido. El club decidió que
-- el piso real son 3.
--
-- ── Esto NO evita que vuelva a pasar ────────────────────────────────────────
-- Subir `reco_min_ganador` de 2 a 3 en Ajustes → Puntaje → Quórum de
-- reconocimientos. Si no, el próximo partido reparte lo mismo y hay que volver
-- a correr esto.
--
-- ── Dos cosas que un DELETE pelado no cubre ─────────────────────────────────
-- 1. Volverían a aparecer. El conteo se rehace entero (cierre manual,
--    auto-cierre y cron), así que reabrir y cerrar una votación los recrea desde
--    los votos, que siguen ahí. Por eso van primero a badges_revocados, que es
--    el veto que tallyAndAssign respeta.
-- 2. El rating queda desfasado. Cada reconocimiento vale ±0.02 y los
--    rating_events ya aplicados los incluyen. Después de correr esto hay que
--    darle a ♻️ Recalcular (Ajustes → Puntaje), o la gente queda con el puntaje
--    de unos reconocimientos que ya no tiene.
--
-- Seguro de re-correr. Solo toca votos <= 2; un NULL en votos (reconocimiento
-- anterior a la columna) no entra, que es el lado prudente.
-- ════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ── PASO 1: mirar antes de borrar ───────────────────────────────────────────
-- Corre esto solo primero. Si la lista no es la que esperas, no sigas.
SELECT
  pr.username,
  pb.badge_emoji || ' ' || pb.badge_nombre AS reconocimiento,
  pb.votos,
  p.fecha
FROM public.player_badges pb
LEFT JOIN public.profiles pr ON pr.id = pb.player_id
LEFT JOIN public.partidos p  ON p.id  = pb.partido_id
WHERE pb.votos <= 2
ORDER BY p.fecha DESC NULLS LAST, pr.username;

-- Cuántos son, y cuántos quedan.
SELECT
  count(*) FILTER (WHERE votos <= 2)  AS se_borran,
  count(*) FILTER (WHERE votos >= 3)  AS se_quedan,
  count(*) FILTER (WHERE votos IS NULL) AS sin_conteo_no_se_tocan,
  count(*)                            AS total
FROM public.player_badges;


-- ── PASO 2: dejar el veto para que no reaparezcan ───────────────────────────
-- Solo los que tienen partido asociado: badges_revocados.partido_id es NOT NULL.
-- Un player_badges con partido_id NULL (el partido se borró) no puede reaparecer
-- de un re-conteo de todos modos, porque no hay partido que contar.
INSERT INTO public.badges_revocados (club_id, partido_id, player_id, badge_id, motivo)
SELECT pb.club_id, pb.partido_id, pb.player_id, pb.badge_id,
       'Limpieza 2026-09-18: ganado con ' || pb.votos || ' voto(s), mínimo 3'
FROM public.player_badges pb
WHERE pb.votos <= 2
  AND pb.partido_id IS NOT NULL
ON CONFLICT ON CONSTRAINT badges_revocados_unique DO NOTHING;


-- ── PASO 3: borrarlos ───────────────────────────────────────────────────────
DELETE FROM public.player_badges
WHERE votos <= 2;


-- ── PASO 4: verificar ───────────────────────────────────────────────────────
-- La primera debe dar 0.
SELECT count(*) AS quedan_con_2_o_menos
FROM public.player_badges WHERE votos <= 2;

-- Cómo quedó repartido lo que sobrevivió.
SELECT votos, count(*) AS cuantos
FROM public.player_badges
GROUP BY votos ORDER BY votos;

-- ⚠️ Ahora sí: Ajustes → Puntaje → ♻️ Recalcular ratings.
--    Hasta que lo hagas, el puntaje de la gente todavía incluye los
--    reconocimientos que acabas de borrar.
