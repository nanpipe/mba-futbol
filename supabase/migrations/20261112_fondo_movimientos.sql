-- ════════════════════════════════════════════════════════════════════════════
-- Fondo MBA: libro de movimientos
--
-- Hasta acá el fondo no existía en la base. La pestaña 💰 mostraba una cuenta
-- TEÓRICA (1.000 por persona y por partido, derivada de las inscripciones) y no
-- había forma de registrar nada: ni lo que de verdad se recogió, ni un gasto.
-- La plata real se lleva a mano en un mensaje de WhatsApp.
--
-- Esta tabla es ese mensaje, pero con saldo. Un solo libro, con el signo dentro
-- del monto, para que el saldo sea un SUM(monto) y no haya que recordar qué
-- signo le toca a cada tipo. Un CHECK ata el signo al tipo, así que la base no
-- deja guardar un gasto en positivo.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.fondo_movimientos (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id      uuid        NOT NULL REFERENCES public.clubs(id),
  fecha        date        NOT NULL,
  tipo         text        NOT NULL
                           CHECK (tipo IN ('aporte','gasto','ajuste','sin_recoger','pendiente')),
  monto        integer     NOT NULL,
  partido_id   uuid        REFERENCES public.partidos(id) ON DELETE SET NULL,
  encargado_id uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  concepto     text,
  created_by   uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- Los cinco tipos y su signo:
  --   aporte       > 0   se recogió y entró ("OCTUBRE 27 = 14.000")
  --   gasto        < 0   salió plata del fondo
  --   ajuste      <> 0   cuadre contra el saldo real de la cuenta Nu
  --   sin_recoger   0    ese partido no aportó, con el motivo en `concepto`
  --   pendiente     0    alguien la tiene y no la ha entregado ("Montes ?")
  --
  -- sin_recoger y pendiente valen 0 a propósito: dejan constancia de que el
  -- partido ya se revisó, sin inventarle un monto, y no ensucian el SUM.
  CONSTRAINT fondo_signo CHECK (
       (tipo = 'aporte' AND monto >  0)
    OR (tipo = 'gasto'  AND monto <  0)
    OR (tipo = 'ajuste' AND monto <> 0)
    OR (tipo IN ('sin_recoger','pendiente') AND monto = 0)
  ),

  -- Un 'sin_recoger' o un 'pendiente' sin partido no dice nada: son estados DE
  -- un partido. Un 'aporte' sí puede no tener partido (los del 5 y 8 de mayo de
  -- 2026 son anteriores al primer partido que hay en la base, y la plata entró
  -- igual), y un gasto o un ajuste nunca lo tienen.
  CONSTRAINT fondo_partido_requerido CHECK (
    tipo NOT IN ('sin_recoger','pendiente') OR partido_id IS NOT NULL
  )
);

-- RLS activo y CERO políticas, igual que `player_thumbs` y `votos_reconocimiento`.
-- El navegador no lee ni escribe esta tabla: todo pasa por api/admin con la
-- service key, que se salta RLS. Una política de lectura para {authenticated}
-- publicaría la plata del club a cualquier jugador con sesión, y una de
-- escritura abriría un camino paralelo que evita las validaciones del API.
-- Ver el invariante de RLS en HANDOFF.md §3.
ALTER TABLE public.fondo_movimientos ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_fondo_club_fecha
  ON public.fondo_movimientos(club_id, fecha);

-- Un solo renglón de fondo por partido. Es lo que hace idempotente la carga de
-- la historia y lo que impide contar dos veces la plata de un mismo partido.
-- Los gastos y los ajustes no llevan partido, así que no los toca.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fondo_un_renglon_por_partido
  ON public.fondo_movimientos(partido_id)
  WHERE partido_id IS NOT NULL AND tipo IN ('aporte','sin_recoger','pendiente');

-- ── Verificación ────────────────────────────────────────────────────────────
-- Debe dar 0 filas (tabla recién creada) y rowsecurity = true.
SELECT (SELECT count(*) FROM public.fondo_movimientos) AS filas,
       (SELECT rowsecurity FROM pg_tables
         WHERE schemaname = 'public' AND tablename = 'fondo_movimientos') AS rls,
       (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'fondo_movimientos') AS politicas;
