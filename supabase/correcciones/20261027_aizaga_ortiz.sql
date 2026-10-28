-- ════════════════════════════════════════════════════════════════════════════
-- Corrección del partido del martes 27 de octubre de 2026
--   · aizaga11 NO jugó          → sale de la inscripción y del equipo
--   · ortiz97 SÍ jugó (blancos) → confirmado y en el equipo blanco
--   · invitado de ortiz97       → confirmado y en el equipo blanco
--   · 3 👎 a aizaga11 (en broma) → pasan a ortiz97 (mismos votantes)
--
-- Se puede correr aunque la versión anterior ya se haya corrido: todo es
-- idempotente. Solo se detiene si los 👎 de aizaga11 ya se borraron (ver B).
--
-- PASO 1 (este archivo, bloque A): mirar. Solo lectura.
-- PASO 2 (bloque B): corregir. Todo o nada.
-- PASO 3 (en la app): Admin → Historial → partido del 27 → EDITAR RESULTADO →
--         Guardar con el MISMO marcador. Eso deshace y recalcula el puntaje del
--         partido para todos con los datos ya corregidos.
-- ════════════════════════════════════════════════════════════════════════════


-- ── A. DIAGNÓSTICO (solo lectura) ──────────────────────────────────────────
-- Debe salir UN partido. Si salen dos, avisar antes de seguir.
SELECT p.id, p.fecha, p.resultado, p.evaluaciones_abiertas,
       (SELECT string_agg(e.nombre || '=' || coalesce(e.color, '?'), ', ')
          FROM equipos e WHERE e.partido_id = p.id) AS equipos
FROM partidos p
WHERE p.fecha = '2026-10-27';

-- Cómo están los dos hoy en ese partido.
SELECT pr.username,
       i.estado                    AS inscripcion,
       e.color                     AS equipo,
       re.delta, re.motivos,
       (SELECT count(*) FROM player_thumbs t
         WHERE t.partido_id = p.id AND t.votado_id = pr.id AND t.value = -1) AS pulgares_neg,
       (SELECT count(*) FROM player_thumbs t
         WHERE t.partido_id = p.id AND t.votado_id = pr.id AND t.value = 1)  AS pulgares_pos,
       pr.habilidad AS puntaje_actual
FROM partidos p
CROSS JOIN profiles pr
LEFT JOIN inscripciones i     ON i.partido_id = p.id AND i.player_id = pr.id
LEFT JOIN equipo_jugadores ej ON ej.player_id = pr.id
                             AND ej.equipo_id IN (SELECT id FROM equipos WHERE partido_id = p.id)
LEFT JOIN equipos e           ON e.id = ej.equipo_id
LEFT JOIN rating_events re    ON re.partido_id = p.id AND re.player_id = pr.id
WHERE p.fecha = '2026-10-27'
  AND lower(pr.username) IN ('aizaga11', 'ortiz97');

-- Invitados de ortiz97 en ese partido (puede no haber ninguno).
SELECT inv.id, inv.nombre, inv.estado, e.color AS equipo
FROM invitados inv
JOIN partidos p  ON p.id = inv.partido_id
JOIN profiles pr ON pr.id = inv.player_id
LEFT JOIN equipos e ON e.id = inv.equipo_id
WHERE p.fecha = '2026-10-27' AND lower(pr.username) = 'ortiz97';


-- ── B. CORRECCIÓN ──────────────────────────────────────────────────────────
-- Si algo no cuadra (no hay partido, hay dos, no hay equipo blanco, no existe
-- el usuario) se detiene con un error y NO cambia nada.
--
-- Si ortiz97 no tiene un invitado registrado en ese partido, se crea uno con
-- el nombre de abajo. Cámbialo por el nombre real si lo sabes.
DO $$
DECLARE
  v_nombre_invitado text := 'Invitado de Ortiz97';

  v_partido uuid;
  v_club    uuid;
  v_blanco  uuid;
  v_aizaga  uuid;
  v_ortiz   uuid;
  u_aizaga  text;
  u_ortiz   text;
  v_n       int;
BEGIN
  SELECT count(*) INTO v_n FROM partidos WHERE fecha = '2026-10-27';
  IF v_n <> 1 THEN RAISE EXCEPTION 'Esperaba 1 partido el 27-oct y hay %', v_n; END IF;
  SELECT id, club_id INTO v_partido, v_club FROM partidos WHERE fecha = '2026-10-27';

  SELECT id INTO v_blanco FROM equipos WHERE partido_id = v_partido AND color = 'blanco';
  IF v_blanco IS NULL THEN RAISE EXCEPTION 'El partido no tiene equipo blanco'; END IF;

  SELECT id, username INTO v_aizaga, u_aizaga FROM profiles WHERE lower(username) = 'aizaga11';
  SELECT id, username INTO v_ortiz,  u_ortiz  FROM profiles WHERE lower(username) = 'ortiz97';
  IF v_aizaga IS NULL THEN RAISE EXCEPTION 'No existe aizaga11'; END IF;
  IF v_ortiz  IS NULL THEN RAISE EXCEPTION 'No existe ortiz97';  END IF;

  -- aizaga11: fuera del partido.
  DELETE FROM equipo_jugadores
   WHERE player_id = v_aizaga
     AND equipo_id IN (SELECT id FROM equipos WHERE partido_id = v_partido);
  DELETE FROM inscripciones WHERE partido_id = v_partido AND player_id = v_aizaga;

  -- Las rotaciones guardan usernames: donde estaba aizaga11 en el blanco va
  -- ortiz97; en cualquier otro equipo, simplemente sale.
  UPDATE equipos
     SET rotacion_banca   = array_replace(rotacion_banca,   u_aizaga, u_ortiz),
         rotacion_portero = array_replace(rotacion_portero, u_aizaga, u_ortiz)
   WHERE id = v_blanco;
  UPDATE equipos
     SET rotacion_banca   = array_remove(rotacion_banca,   u_aizaga),
         rotacion_portero = array_remove(rotacion_portero, u_aizaga)
   WHERE partido_id = v_partido AND id <> v_blanco;
  UPDATE equipos
     SET portero_fijo_id = NULL, portero_fijo = false
   WHERE partido_id = v_partido AND lower(portero_fijo_id) = 'aizaga11';

  -- Los 👎 en broma a aizaga11 pasan a ortiz97, con los mismos votantes.
  -- Si ortiz97 fue uno de los que votó, ese no se pasa (no hay auto-votos).
  -- Si alguien ya le había dado 👍 a ortiz97, queda en 👎 (un voto por par).
  SELECT count(*) INTO v_n FROM player_thumbs
   WHERE partido_id = v_partido AND votado_id = v_aizaga AND value = -1;
  IF v_n = 0 AND NOT EXISTS (
       SELECT 1 FROM player_thumbs
        WHERE partido_id = v_partido AND votado_id = v_ortiz AND value = -1) THEN
    RAISE EXCEPTION 'aizaga11 ya no tiene 👎 en este partido (se borraron con la versión anterior) y ortiz97 tampoco tiene: no se sabe quién votó. No se cambió nada.';
  END IF;

  INSERT INTO player_thumbs (club_id, partido_id, votante_id, votado_id, value)
  SELECT t.club_id, t.partido_id, t.votante_id, v_ortiz, -1
    FROM player_thumbs t
   WHERE t.partido_id = v_partido AND t.votado_id = v_aizaga AND t.value = -1
     AND t.votante_id <> v_ortiz
  ON CONFLICT (partido_id, votante_id, votado_id) DO UPDATE SET value = -1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '👎 pasados a ortiz97: %', v_n;

  DELETE FROM player_thumbs
   WHERE partido_id = v_partido AND votado_id = v_aizaga AND value = -1;

  -- ortiz97: confirmado y en el blanco (sacándolo de otro equipo si estaba).
  INSERT INTO inscripciones (club_id, partido_id, player_id, estado, posicion_espera)
  VALUES (v_club, v_partido, v_ortiz, 'confirmado', NULL)
  ON CONFLICT (partido_id, player_id)
  DO UPDATE SET estado = 'confirmado', posicion_espera = NULL;

  DELETE FROM equipo_jugadores
   WHERE player_id = v_ortiz
     AND equipo_id IN (SELECT id FROM equipos WHERE partido_id = v_partido AND id <> v_blanco);
  INSERT INTO equipo_jugadores (club_id, equipo_id, player_id)
  VALUES (v_club, v_blanco, v_ortiz)
  ON CONFLICT (equipo_id, player_id) DO NOTHING;

  -- Invitado de ortiz97: confirmado y en el blanco.
  UPDATE invitados
     SET estado = 'confirmado', posicion_espera = NULL, equipo_id = v_blanco
   WHERE partido_id = v_partido AND player_id = v_ortiz;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    INSERT INTO invitados (club_id, partido_id, player_id, nombre, estado, posicion_espera, equipo_id)
    VALUES (v_club, v_partido, v_ortiz, v_nombre_invitado, 'confirmado', NULL, v_blanco);
    RAISE NOTICE 'No había invitado de ortiz97: se creó "%"', v_nombre_invitado;
  ELSE
    RAISE NOTICE 'Invitados de ortiz97 actualizados: %', v_n;
  END IF;
END $$;

-- Después de B, correr de nuevo el segundo SELECT del bloque A: aizaga11 debe
-- salir sin inscripción ni equipo y 0 pulgares negativos; ortiz97 confirmado
-- y en blanco. El delta/motivos todavía son los viejos hasta hacer el PASO 3.
