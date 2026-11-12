-- ════════════════════════════════════════════════════════════════════════════
-- Carga de la historia del fondo (mayo a noviembre de 2026)
--
-- Son las 48 líneas de la lista que el club lleva en WhatsApp. Suman $ 627.000,
-- que es el número que el grupo ya conoce de memoria: si al final la suma no da
-- eso, el bloque B se detiene y NO cambia nada.
--
-- Requiere `20261112_fondo_movimientos.sql` corrida antes.
--
-- PASO 1 (bloque A): mirar. Solo lectura.
-- PASO 2 (bloque B): cargar. Todo o nada, y se puede correr dos veces.
--
-- Dos cosas que la lista traía mal y acá van corregidas, cada una comentada en
-- su fila: el 20 de mayo y el 19 de agosto no existen como partido, y sí hay
-- partido el 19 de mayo y el 18 de agosto. Son dedazos de un día.
--
-- Y una que NO se corrige a propósito: hay 7 partidos jugados que no aparecen
-- en la lista (16 jun, 3 y 13 jul, 4, 7, 11 y 14 ago). Quedan sin registrar y
-- el panel los va a mostrar en ámbar. Eso no es un pendiente de esta carga, es
-- el resultado: son los días que hay que ir a preguntar.
-- ════════════════════════════════════════════════════════════════════════════


-- ── A. DIAGNÓSTICO (solo lectura) ──────────────────────────────────────────

-- 1. ¿Está la tabla? Debe dar una fila.
SELECT count(*) AS existe_la_tabla
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'fondo_movimientos';

-- 2. ¿Ya hay algo cargado? En limpio: 0.
SELECT count(*) AS movimientos, coalesce(sum(monto), 0) AS saldo
FROM public.fondo_movimientos;

-- 3. Los cuatro encargados que nombra la lista. Deben salir los cuatro.
SELECT username FROM public.profiles
WHERE lower(username) IN ('alexis16', 'magic80', 'montes31', 'hernan14')
ORDER BY username;

-- 4. Partidos jugados hasta hoy. Deben ser 53 (46 quedarán con renglón, 7 sin).
SELECT count(*) AS jugados_hasta_hoy
FROM public.partidos
WHERE fecha <= (now() AT TIME ZONE 'America/Bogota')::date
  AND jugado IS DISTINCT FROM false;


-- ── B. CARGA ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_club  uuid;
  v_n     int;
  v_ins   int;
  v_suma  bigint;
BEGIN
  -- Un solo club. El día que haya dos, esta carga hay que volverla a pensar en
  -- vez de dejar que elija uno sola.
  SELECT count(DISTINCT club_id) INTO v_n FROM public.partidos;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Hay % clubes con partidos y esta carga es de uno solo. No se cambió nada.', v_n;
  END IF;
  SELECT DISTINCT club_id INTO v_club FROM public.partidos;

  -- Los cuatro encargados tienen que existir. Si falta uno, se para: inventar
  -- un id para que cuadre la cuenta es peor que no cargar.
  SELECT count(*) INTO v_n FROM public.profiles
   WHERE club_id = v_club
     AND lower(username) IN ('alexis16', 'magic80', 'montes31', 'hernan14');
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'Esperaba 4 encargados (alexis16, magic80, montes31, hernan14) y encontré %. No se cambió nada.', v_n;
  END IF;

  WITH datos(fecha_mensaje, fecha_partido, tipo, monto, encargado, concepto) AS (
    VALUES
      -- ── MAYO: 100.000 ──
      -- Los dos primeros son anteriores al 15 de mayo, que es el partido más
      -- viejo que hay en la app. La plata entró igual, así que van sin partido.
      ('2026-05-05'::date, NULL::date,         'aporte', 16000, NULL::text,  'De la lista de WhatsApp; no hay partido de ese día en la app'::text),
      ('2026-05-08',       NULL,               'aporte', 14000, NULL,        'De la lista de WhatsApp; no hay partido de ese día en la app'),
      ('2026-05-15',       '2026-05-15',       'aporte', 14000, NULL,        NULL),
      ('2026-05-20',       '2026-05-19',       'aporte', 14000, NULL,        'La lista decía 20 de mayo; el partido fue el 19'),
      ('2026-05-22',       '2026-05-22',       'aporte', 14000, NULL,        NULL),
      ('2026-05-26',       '2026-05-26',       'aporte', 14000, NULL,        NULL),
      ('2026-05-29',       '2026-05-29',       'aporte', 14000, NULL,        NULL),

      -- ── JUNIO: 112.000 ──
      ('2026-06-02',       '2026-06-02',       'aporte', 14000, NULL,        NULL),
      ('2026-06-05',       '2026-06-05',       'aporte', 14000, NULL,        NULL),
      ('2026-06-09',       '2026-06-09',       'aporte', 14000, NULL,        NULL),
      ('2026-06-12',       '2026-06-12',       'aporte', 14000, NULL,        NULL),
      ('2026-06-19',       '2026-06-19',       'aporte', 14000, NULL,        NULL),
      ('2026-06-23',       '2026-06-23',       'aporte', 14000, NULL,        NULL),
      ('2026-06-26',       '2026-06-26',       'aporte', 14000, NULL,        NULL),
      ('2026-06-30',       '2026-06-30',       'aporte', 14000, NULL,        NULL),

      -- ── JULIO: 123.000 ──
      ('2026-07-07',       '2026-07-07',       'aporte', 14000, NULL,        NULL),
      ('2026-07-10',       '2026-07-10',       'aporte', 14000, NULL,        NULL),
      ('2026-07-14',       '2026-07-14',       'aporte', 14000, NULL,        NULL),
      ('2026-07-17',       '2026-07-17',       'aporte', 14000, NULL,        NULL),
      ('2026-07-21',       '2026-07-21',       'aporte', 14000, NULL,        NULL),
      ('2026-07-24',       '2026-07-24',       'aporte', 14000, NULL,        NULL),
      ('2026-07-28',       '2026-07-28',       'aporte', 14000, NULL,        NULL),
      ('2026-07-31',       '2026-07-31',       'aporte', 25000, NULL,        'La lista marca 25.000 ese día'),

      -- ── AGOSTO: 56.000 ──
      ('2026-08-19',       '2026-08-18',       'aporte', 14000, NULL,        'La lista decía 19 de agosto; el partido fue el 18'),
      ('2026-08-21',       '2026-08-21',       'aporte', 14000, NULL,        NULL),
      ('2026-08-25',       '2026-08-25',       'aporte', 14000, NULL,        NULL),
      ('2026-08-28',       '2026-08-28',       'aporte', 14000, NULL,        NULL),

      -- ── SEPTIEMBRE: 112.000 + uno pendiente ──
      ('2026-09-01',       '2026-09-01',       'aporte', 14000, NULL,        NULL),
      ('2026-09-04',       '2026-09-04',       'aporte', 14000, NULL,        NULL),
      ('2026-09-08',       '2026-09-08',       'aporte', 14000, NULL,        NULL),
      ('2026-09-11',       '2026-09-11',       'aporte', 14000, NULL,        NULL),
      ('2026-09-15',       '2026-09-15',       'aporte', 14000, NULL,        NULL),
      ('2026-09-18',       '2026-09-18',       'aporte', 14000, NULL,        NULL),
      ('2026-09-22',       '2026-09-22',       'aporte', 14000, NULL,        NULL),
      ('2026-09-25',       '2026-09-25',       'aporte', 14000, NULL,        NULL),
      -- La lista dice "? Alexis y Magic": son dos, y la columna guarda uno.
      -- Va Alexis y los dos nombres quedan escritos en el concepto.
      ('2026-09-29',       '2026-09-29',       'pendiente',  0, 'alexis16',  'Alexis y Magic'),

      -- ── OCTUBRE: 111.000 ──
      ('2026-10-02',       '2026-10-02',       'sin_recoger', 0, NULL,       NULL),
      ('2026-10-06',       '2026-10-06',       'aporte', 14000, NULL,        NULL),
      ('2026-10-09',       '2026-10-09',       'aporte', 14000, NULL,        NULL),
      ('2026-10-13',       '2026-10-13',       'aporte', 14000, NULL,        NULL),
      ('2026-10-16',       '2026-10-16',       'aporte', 14000, NULL,        NULL),
      ('2026-10-20',       '2026-10-20',       'aporte', 14000, NULL,        NULL),
      ('2026-10-23',       '2026-10-23',       'aporte', 13000, NULL,        NULL),
      ('2026-10-27',       '2026-10-27',       'aporte', 14000, NULL,        NULL),
      ('2026-10-30',       '2026-10-30',       'aporte', 14000, NULL,        NULL),

      -- ── NOVIEMBRE: 13.000 + uno pendiente + uno sin recoger ──
      ('2026-11-03',       '2026-11-03',       'pendiente',   0, 'montes31', 'Montes'),
      ('2026-11-06',       '2026-11-06',       'sin_recoger', 0, NULL,       'Faltó gente por lluvia'),
      ('2026-11-10',       '2026-11-10',       'aporte',  13000, 'hernan14', NULL)
  )
  INSERT INTO public.fondo_movimientos (club_id, fecha, tipo, monto, partido_id, encargado_id, concepto)
  SELECT v_club,
         -- La fecha del movimiento es la del PARTIDO cuando hay partido. Las dos
         -- filas corregidas quedan en el día real, no en el que decía el mensaje.
         coalesce(d.fecha_partido, d.fecha_mensaje),
         d.tipo, d.monto, p.id, pr.id, d.concepto
    FROM datos d
    LEFT JOIN public.partidos p
           ON p.club_id = v_club AND p.fecha = d.fecha_partido
    LEFT JOIN public.profiles pr
           ON pr.club_id = v_club AND lower(pr.username) = d.encargado
   WHERE NOT EXISTS (
     -- Idempotencia. Para las filas con partido alcanzaría el índice único, pero
     -- los dos aportes de mayo no tienen partido y el índice no los cubre: sin
     -- esto, correr el archivo dos veces los duplicaría.
     SELECT 1 FROM public.fondo_movimientos f
      WHERE f.club_id = v_club
        AND ( (p.id IS NOT NULL AND f.partido_id = p.id)
           OR (p.id IS NULL AND f.partido_id IS NULL
               AND f.fecha = d.fecha_mensaje AND f.tipo = d.tipo) )
   );

  GET DIAGNOSTICS v_ins = ROW_COUNT;
  RAISE NOTICE 'Movimientos insertados: % (0 si ya estaba cargado)', v_ins;

  -- Toda fila que nombraba un partido tenía que encontrarlo. Si una no lo
  -- encontró entró con partido_id NULL, y entonces habría más de 2 sin partido.
  SELECT count(*) INTO v_n FROM public.fondo_movimientos
   WHERE club_id = v_club AND partido_id IS NULL
     AND tipo IN ('aporte', 'sin_recoger', 'pendiente');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'Esperaba 2 aportes sin partido (5 y 8 de mayo) y hay %: alguna fecha no encontró su partido. No se cambió nada.', v_n;
  END IF;

  -- La prueba de fuego. Se mide solo sobre los aportes, para que un gasto que ya
  -- se hubiera registrado no haga fallar la carga.
  SELECT coalesce(sum(monto), 0) INTO v_suma FROM public.fondo_movimientos
   WHERE club_id = v_club AND tipo = 'aporte';
  IF v_suma <> 627000 THEN
    RAISE EXCEPTION 'Lo recaudado quedó en % y la lista de WhatsApp dice 627000. No se cambió nada.', v_suma;
  END IF;

  RAISE NOTICE 'Listo: recaudado = 627.000.';
END $$;


-- ── C. COMPROBACIÓN ────────────────────────────────────────────────────────
-- Esperado: recaudado 627.000, gastado 0, saldo 627.000, 1 sin_recoger ×2,
-- 2 pendientes, y 7 partidos jugados sin renglón de fondo.
SELECT tipo, count(*) AS n, sum(monto) AS total
FROM public.fondo_movimientos
GROUP BY tipo ORDER BY tipo;

SELECT sum(monto) AS saldo FROM public.fondo_movimientos;

SELECT p.fecha, p.dia_semana
FROM public.partidos p
WHERE p.fecha <= (now() AT TIME ZONE 'America/Bogota')::date
  AND p.jugado IS DISTINCT FROM false
  AND NOT EXISTS (
    SELECT 1 FROM public.fondo_movimientos f
     WHERE f.partido_id = p.id AND f.tipo IN ('aporte', 'sin_recoger', 'pendiente'))
ORDER BY p.fecha;
