-- ═══════════════════════════════════════════════════════════════════════════
-- schema_current.sql — MBA Fútbol Club (Supabase)
-- Canonical single-file schema. Generated 2026-05-27.
--
-- This file merges ALL migrations up to and including:
--   00000000_baseline_schema.sql
--   20260507_balancer_knowledge.sql
--   20260507_equipos_rotacion.sql
--   20260508_evaluaciones_carta.sql
--   20260508_invitados_equipo_portero_fijo.sql
--   20260509_partidos_goles.sql
--   20260513_app_settings.sql
--   20260513_app_settings_email.sql
--   20260514_inscripciones_added_by.sql
--   20260514_minitorneo.sql
--   20260514_superadmin_role.sql
--   20260525_multi_tenant_phase1.sql
--   20260525_club_signup_trigger.sql
--   20260526_player_badges_unique_constraint.sql
--
-- ALTER ADD COLUMN statements have been folded into their CREATE TABLE.
-- FK dependencies are resolved top-to-bottom:
--   clubs → profiles → partidos → inscripciones → invitados
--       → equipos → equipo_jugadores
--       → push_subscriptions
--       → player_knowledge → balancer_feedback
--       → votos_reconocimiento → player_badges
--       → evaluaciones_carta
--       → activity_log → notificaciones_pendientes
--       → app_settings
--       → bug_reports
--
-- Use CREATE TABLE IF NOT EXISTS — safe to run on a fresh project.
-- DO NOT run on a live production DB without verifying idempotency.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 1: clubs
-- Root tenant table. Every other table references this via club_id.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.clubs (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                      text        NOT NULL,
  slug                        text        NOT NULL UNIQUE,       -- used as subdomain
  timezone                    text        NOT NULL DEFAULT 'America/Bogota',
  plan                        text        NOT NULL DEFAULT 'basico'
                                          CHECK (plan IN ('gratis', 'basico', 'pro')),
  subscription_status         text        NOT NULL DEFAULT 'active'
                                          CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled')),
  stripe_customer_id          text,
  stripe_subscription_id      text,
  ciudad                      text,
  logo_url                    text,
  color_primary               text        DEFAULT '#22c55e',
  dias_juego                  text[]      DEFAULT '{}',
  hora_default                time        DEFAULT '19:00:00',
  hora_apertura_default       time        DEFAULT '10:00:00',
  dias_antes_apertura_default integer     DEFAULT 2,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;

-- Seed: MBA FC as first tenant (fixed UUID for backward compatibility)
INSERT INTO public.clubs (
  id, nombre, slug, timezone, plan, subscription_status,
  ciudad, dias_juego, hora_default, hora_apertura_default, dias_antes_apertura_default
) VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'MBA Fútbol Club',
  'mbafc',
  'America/Bogota',
  'pro',
  'active',
  'Bogotá',
  ARRAY['martes', 'viernes'],
  '19:00:00',
  '10:00:00',
  2
) ON CONFLICT (id) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 2: profiles
-- Extends auth.users. Created automatically via trigger on signup.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.profiles (
  id               uuid         PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  club_id          uuid         NOT NULL REFERENCES public.clubs(id),
  username         text         NOT NULL,
  email            text         NOT NULL,
  ip_registro      text,
  role             text         NOT NULL DEFAULT 'player'
                                CHECK (role IN ('player', 'admin', 'superadmin')),
  baneado          boolean      NOT NULL DEFAULT false,
  aprobado         boolean      NOT NULL DEFAULT false,
  uniform          boolean      NOT NULL DEFAULT false,
  fecha_ban        timestamptz,
  fecha_liberacion text,
  razon_ban        text,
  avatar_url       text,
  posicion         text,
  habilidad        numeric      NOT NULL DEFAULT 3.0,
  created_at       timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_profiles_club ON public.profiles(club_id);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 3: partidos
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.partidos (
  id                      uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id                 uuid        NOT NULL REFERENCES public.clubs(id),
  fecha                   date        NOT NULL,
  dia_semana              text        NOT NULL,
  hora                    time        NOT NULL DEFAULT '19:00:00',
  cupos_total             integer     NOT NULL DEFAULT 14,
  inscripcion_abierta     boolean     NOT NULL DEFAULT false,
  hora_apertura           time        NOT NULL DEFAULT '10:00:00',
  dias_antes_apertura     integer     NOT NULL DEFAULT 2,
  notif_apertura_sent     boolean     NOT NULL DEFAULT false,
  notif_recordatorio_sent boolean     NOT NULL DEFAULT false,
  resultado               text,
  goles_a                 integer,
  goles_b                 integer,
  evaluaciones_abiertas   boolean     NOT NULL DEFAULT false,
  equipos_confirmados     boolean     NOT NULL DEFAULT false,
  tipo                    text        NOT NULL DEFAULT 'normal'
                                      CHECK (tipo IN ('normal', 'minitorneo')),
  puntos_blanco           integer,
  puntos_negro            integer,
  puntos_morado           integer,
  foto_url                text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_id, fecha)
);

ALTER TABLE public.partidos ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_partidos_club ON public.partidos(club_id);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 4: inscripciones
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.inscripciones (
  id              uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id         uuid        NOT NULL REFERENCES public.clubs(id),
  partido_id      uuid        NOT NULL REFERENCES public.partidos ON DELETE CASCADE,
  player_id       uuid        NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  added_by        uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  estado          text        NOT NULL DEFAULT 'confirmado'
                              CHECK (estado IN ('confirmado', 'espera', 'cancelado')),
  posicion_espera integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partido_id, player_id)
);

ALTER TABLE public.inscripciones ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_inscripciones_club ON public.inscripciones(club_id);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 5: invitados
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.invitados (
  id              uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id         uuid        NOT NULL REFERENCES public.clubs(id),
  partido_id      uuid        NOT NULL REFERENCES public.partidos ON DELETE CASCADE,
  player_id       uuid        NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  nombre          varchar     NOT NULL,
  estado          text        NOT NULL DEFAULT 'espera'
                              CHECK (estado IN ('espera', 'confirmado')),
  posicion_espera integer,
  equipo_id       uuid,       -- FK to equipos added after that table; nullable
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invitados ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 6: equipos
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.equipos (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id          uuid        NOT NULL REFERENCES public.clubs(id),
  partido_id       uuid        NOT NULL REFERENCES public.partidos ON DELETE CASCADE,
  nombre           text        NOT NULL,
  confirmado       boolean     NOT NULL DEFAULT false,
  color            text,
  portero_fijo     boolean     DEFAULT false,
  portero_fijo_id  text,
  rotacion_banca   text[]      DEFAULT '{}',
  rotacion_portero text[]      DEFAULT '{}',
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE public.equipos ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_equipos_club ON public.equipos(club_id);

-- Back-fill FK on invitados now that equipos exists
ALTER TABLE public.invitados
  ADD CONSTRAINT IF NOT EXISTS invitados_equipo_id_fkey
  FOREIGN KEY (equipo_id) REFERENCES public.equipos(id) ON DELETE SET NULL;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 7: equipo_jugadores
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.equipo_jugadores (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid        NOT NULL REFERENCES public.clubs(id),
  equipo_id   uuid        NOT NULL REFERENCES public.equipos ON DELETE CASCADE,
  player_id   uuid        NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (equipo_id, player_id)
);

ALTER TABLE public.equipo_jugadores ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 8: push_subscriptions
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid        NOT NULL REFERENCES public.clubs(id),
  player_id   uuid        NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  endpoint    text        NOT NULL,
  p256dh      text        NOT NULL,
  auth        text        NOT NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (player_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_club ON public.push_subscriptions(club_id);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 9: player_knowledge
-- Admin-curated data used by team balancer AI.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.player_knowledge (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        uuid        NOT NULL REFERENCES public.clubs(id),
  username       text        NOT NULL,
  skill_override text,       -- 'high' | 'medium' | 'unknown'
  roles          text[]      DEFAULT '{}',
  traits         text[]      DEFAULT '{}',
  notes          text        DEFAULT '',
  updated_at     timestamptz DEFAULT now(),
  UNIQUE (club_id, username)
);

ALTER TABLE public.player_knowledge ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_player_knowledge_club ON public.player_knowledge(club_id);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 10: balancer_feedback
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.balancer_feedback (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid        NOT NULL REFERENCES public.clubs(id),
  feedback    text        NOT NULL,
  admin_id    uuid        REFERENCES public.profiles ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.balancer_feedback ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 11: votos_reconocimiento
-- One vote per category per voter per match.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.votos_reconocimiento (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid        NOT NULL REFERENCES public.clubs(id),
  partido_id  uuid        NOT NULL REFERENCES public.partidos ON DELETE CASCADE,
  votante_id  uuid        NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  votado_id   uuid        NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  categoria   text        NOT NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (partido_id, votante_id, categoria)
);

ALTER TABLE public.votos_reconocimiento ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 12: player_badges
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.player_badges (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid        NOT NULL REFERENCES public.clubs(id),
  player_id    uuid        NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  badge_id     text        NOT NULL,
  badge_emoji  text        NOT NULL,
  badge_nombre text        NOT NULL,
  partido_id   uuid        REFERENCES public.partidos ON DELETE SET NULL,
  earned_at    timestamptz DEFAULT now(),
  CONSTRAINT player_badges_unique_player_badge_partido
    UNIQUE (player_id, badge_id, partido_id)
);

ALTER TABLE public.player_badges ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_player_badges_club ON public.player_badges(club_id);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 13: evaluaciones_carta
-- FIFA-style player evaluation cards.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.evaluaciones_carta (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        uuid        NOT NULL REFERENCES public.clubs(id),
  player_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Raw answers: { res: [1,4,3,2,5], fis: [...], def: [...], ata: [...], tec: [...], dis: [...] }
  answers        jsonb       NOT NULL DEFAULT '{}',

  -- Calculated stats (45 + score*2 formula; range 55–95)
  stat_res       integer,
  stat_fis       integer,
  stat_def       integer,
  stat_ata       integer,
  stat_tec       integer,
  stat_dis       integer,
  ovr            integer,
  tier           text,       -- 'bronce_bajo' | 'bronce_alto' | 'plata' | 'oro' | 'crack' | 'leyenda'

  -- Basic info from the form
  posicion_carta text,       -- 'arquero' | 'defensa' | 'lateral' | 'volante' | 'extremo' | 'delantero'
  pierna         text,       -- 'derecha' | 'izquierda' | 'ambas'

  -- Admin workflow
  aprobado       boolean     NOT NULL DEFAULT false,
  aprobado_por   uuid        REFERENCES public.profiles(id),
  aprobado_at    timestamptz,
  notas_admin    text,
  rechazado      boolean     NOT NULL DEFAULT false,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id)
);

ALTER TABLE public.evaluaciones_carta ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_evaluaciones_carta_club ON public.evaluaciones_carta(club_id);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 14: activity_log
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.activity_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid        NOT NULL REFERENCES public.clubs(id),
  user_id     uuid        REFERENCES public.profiles ON DELETE SET NULL,
  username    text,
  accion      text        NOT NULL,
  detalles    jsonb,
  ip          text,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_activity_log_club ON public.activity_log(club_id);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 15: notificaciones_pendientes
-- Queue for "promovido" emails when a waiting-list spot opens.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.notificaciones_pendientes (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id       uuid        NOT NULL REFERENCES public.clubs(id),
  player_id     uuid        REFERENCES public.profiles ON DELETE CASCADE,
  email         text        NOT NULL,
  username      text        NOT NULL,
  partido_id    uuid        REFERENCES public.partidos ON DELETE CASCADE,
  fecha_partido date,
  tipo          text        NOT NULL DEFAULT 'promovido',
  enviado       boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notificaciones_pendientes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_notificaciones_club ON public.notificaciones_pendientes(club_id);


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 16: app_settings
-- Key→jsonb store for runtime toggles configurable from admin panel.
-- Primary key is (club_id, key) — one settings namespace per club.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.app_settings (
  club_id     uuid        NOT NULL REFERENCES public.clubs(id),
  key         text        NOT NULL,
  value       jsonb       NOT NULL DEFAULT 'true',
  updated_at  timestamptz DEFAULT now(),
  updated_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (club_id, key)
);

-- Seed default notification toggles for MBA FC
INSERT INTO public.app_settings (club_id, key, value) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'notif_apertura',     'true'),
  ('a0000000-0000-0000-0000-000000000001', 'notif_recordatorio', 'true'),
  ('a0000000-0000-0000-0000-000000000001', 'notif_cupos',        'true'),
  ('a0000000-0000-0000-0000-000000000001', 'notif_invitados',    'true'),
  ('a0000000-0000-0000-0000-000000000001', 'email_apertura',     'true'),
  ('a0000000-0000-0000-0000-000000000001', 'email_recordatorio', 'true')
ON CONFLICT (club_id, key) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 17: bug_reports
-- User-submitted bug reports (not scoped by club_id — global).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.bug_reports (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        REFERENCES public.profiles ON DELETE SET NULL,
  username       text,
  descripcion    text        NOT NULL,
  screenshot_url text,
  estado         text        NOT NULL DEFAULT 'nuevo'
                             CHECK (estado IN ('nuevo', 'revisado', 'cerrado')),
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 18: Seed — player_knowledge for MBA FC
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO public.player_knowledge (club_id, username, skill_override, roles, traits, notes) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'yola0',       'medium',  ARRAY['goalkeeper','defense'],    ARRAY['defensive awareness'],              'ha jugado arquero y defensa'),
  ('a0000000-0000-0000-0000-000000000001', 'molina2',     'medium',  ARRAY['defense'],                 ARRAY['physical'],                         'perfil defensivo'),
  ('a0000000-0000-0000-0000-000000000001', 'danielb3',    'medium',  ARRAY['defense','midfield'],      ARRAY[]::text[],                           ''),
  ('a0000000-0000-0000-0000-000000000001', 'zafra4',      'unknown', ARRAY[]::text[],                  ARRAY[]::text[],                           ''),
  ('a0000000-0000-0000-0000-000000000001', 'marin5',      'medium',  ARRAY['midfield'],                ARRAY[]::text[],                           'corresponde a Daniel M'),
  ('a0000000-0000-0000-0000-000000000001', 'albarracin6', 'unknown', ARRAY[]::text[],                  ARRAY[]::text[],                           ''),
  ('a0000000-0000-0000-0000-000000000001', 'vargas7',     'medium',  ARRAY['defense','midfield'],      ARRAY['physical'],                         ''),
  ('a0000000-0000-0000-0000-000000000001', 'melo8',       'high',    ARRAY['midfield'],                ARRAY['ball control','creative'],           'uno de los jugadores más técnicos'),
  ('a0000000-0000-0000-0000-000000000001', 'juli9',       'medium',  ARRAY['forward'],                 ARRAY['attacking'],                        ''),
  ('a0000000-0000-0000-0000-000000000001', 'mauricio10',  'unknown', ARRAY[]::text[],                  ARRAY[]::text[],                           ''),
  ('a0000000-0000-0000-0000-000000000001', 'aizaga11',    'medium',  ARRAY['defense'],                 ARRAY['good first touch'],                 ''),
  ('a0000000-0000-0000-0000-000000000001', 'csanchez12',  'medium',  ARRAY['midfield'],                ARRAY['balanced'],                         'Cristian'),
  ('a0000000-0000-0000-0000-000000000001', 'hernan14',    'medium',  ARRAY['defense'],                 ARRAY['very physical','aggressive defense'],'defensa fuerte'),
  ('a0000000-0000-0000-0000-000000000001', 'alexis16',    'unknown', ARRAY[]::text[],                  ARRAY[]::text[],                           ''),
  ('a0000000-0000-0000-0000-000000000001', 'jsanchez17',  'medium',  ARRAY['midfield'],                ARRAY[]::text[],                           'Jordan'),
  ('a0000000-0000-0000-0000-000000000001', 'samith18',    'medium',  ARRAY['forward'],                 ARRAY['attacking mindset'],                'le gusta jugar arriba'),
  ('a0000000-0000-0000-0000-000000000001', 'kevin19',     'medium',  ARRAY['defense'],                 ARRAY['strong defense'],                   'defensa hacha'),
  ('a0000000-0000-0000-0000-000000000001', 'andresi20',   'medium',  ARRAY['midfield'],                ARRAY[]::text[],                           ''),
  ('a0000000-0000-0000-0000-000000000001', 'jj21',        'medium',  ARRAY['midfield'],                ARRAY[]::text[],                           ''),
  ('a0000000-0000-0000-0000-000000000001', 'pipes22',     'medium',  ARRAY['goalkeeper','defense'],    ARRAY['good shot'],                        'a veces juega arquero por lesión'),
  ('a0000000-0000-0000-0000-000000000001', 'jhonsito23',  'medium',  ARRAY['midfield'],                ARRAY[]::text[],                           'Jhon Gomez'),
  ('a0000000-0000-0000-0000-000000000001', 'berna24',     'medium',  ARRAY['forward'],                 ARRAY['strong shot'],                      'pegada fuerte'),
  ('a0000000-0000-0000-0000-000000000001', 'andres27',    'medium',  ARRAY['midfield'],                ARRAY['good shot'],                        'Andres R'),
  ('a0000000-0000-0000-0000-000000000001', 'jbravo30',    'medium',  ARRAY['forward'],                 ARRAY[]::text[],                           'Juan David'),
  ('a0000000-0000-0000-0000-000000000001', 'montes31',    'unknown', ARRAY[]::text[],                  ARRAY[]::text[],                           ''),
  ('a0000000-0000-0000-0000-000000000001', 'mati33',      'medium',  ARRAY['midfield','forward'],      ARRAY['plays well with magic'],            ''),
  ('a0000000-0000-0000-0000-000000000001', 'ferney37',    'unknown', ARRAY[]::text[],                  ARRAY[]::text[],                           ''),
  ('a0000000-0000-0000-0000-000000000001', 'guerrero44',  'unknown', ARRAY[]::text[],                  ARRAY[]::text[],                           'Hamilton'),
  ('a0000000-0000-0000-0000-000000000001', 'mendieta69',  'unknown', ARRAY[]::text[],                  ARRAY[]::text[],                           ''),
  ('a0000000-0000-0000-0000-000000000001', 'magic70',     'high',    ARRAY['midfield','forward'],      ARRAY['creative','ball control'],           'jugador habilidoso'),
  ('a0000000-0000-0000-0000-000000000001', 'serazo73',    'medium',  ARRAY['goalkeeper'],              ARRAY[]::text[],                           'Santiago E, arquero'),
  ('a0000000-0000-0000-0000-000000000001', 'sandoval77',  'unknown', ARRAY[]::text[],                  ARRAY[]::text[],                           'Yonier'),
  ('a0000000-0000-0000-0000-000000000001', 'ortiz97',     'unknown', ARRAY[]::text[],                  ARRAY['physically strong','strong shot'],  'Fisicamente fuerte, disparo fuerte')
ON CONFLICT (club_id, username) DO UPDATE SET
  skill_override = EXCLUDED.skill_override,
  roles          = EXCLUDED.roles,
  traits         = EXCLUDED.traits,
  notes          = EXCLUDED.notes,
  updated_at     = now();

-- Seed balancer feedback for MBA FC
INSERT INTO public.balancer_feedback (club_id, feedback) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Magic (magic70) y Mati (mati33) son padre e hijo — siempre ponerlos en el mismo equipo'),
  ('a0000000-0000-0000-0000-000000000001', 'melo8 es uno de los jugadores más técnicos del grupo — distribuir bien su impacto'),
  ('a0000000-0000-0000-0000-000000000001', 'hernan14 es defensa muy físico y agresivo — no juntar con otro defensa del mismo perfil si es posible'),
  ('a0000000-0000-0000-0000-000000000001', 'samith18 prefiere jugar de delantero, respetar esa posición'),
  ('a0000000-0000-0000-0000-000000000001', 'serazo73 es el arquero designado — priorizar como portero de uno de los equipos'),
  ('a0000000-0000-0000-0000-000000000001', 'pipes22 puede jugar de arquero en caso de lesión — segundo portero disponible')
ON CONFLICT DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 19: RLS Policies
-- Pattern: users see data from their own club only.
-- Superadmin bypasses all club scoping.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── clubs ────────────────────────────────────────────────────────────────────

CREATE POLICY "Superadmin full access on clubs"
  ON public.clubs FOR ALL TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'superadmin');

CREATE POLICY "Admin reads own club"
  ON public.clubs FOR SELECT TO authenticated
  USING (id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Admin updates own club"
  ON public.clubs FOR UPDATE TO authenticated
  USING (
    id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

-- ── profiles ──────────────────────────────────────────────────────────────────

-- All authenticated users see profiles in their club
CREATE POLICY "Ver perfiles del club"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'superadmin'
  );

-- Users update own profile
CREATE POLICY "Usuario actualiza propio perfil"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id);

-- Admin updates any profile in same club
CREATE POLICY "Admin actualiza perfiles del club"
  ON public.profiles FOR UPDATE TO authenticated
  USING (
    club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

-- Insert: new user self-registers with club_id
CREATE POLICY "Insert propio perfil"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- ── partidos ──────────────────────────────────────────────────────────────────

CREATE POLICY "Ver partidos del club"
  ON public.partidos FOR SELECT TO authenticated
  USING (
    club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'superadmin'
  );

CREATE POLICY "Admin modifica partidos del club"
  ON public.partidos FOR ALL TO authenticated
  USING (
    club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

-- ── inscripciones ─────────────────────────────────────────────────────────────

CREATE POLICY "Ver inscripciones del club"
  ON public.inscripciones FOR SELECT TO authenticated
  USING (club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Usuario se inscribe"
  ON public.inscripciones FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = player_id
    AND club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "Usuario cancela inscripción"
  ON public.inscripciones FOR DELETE TO authenticated
  USING (auth.uid() = player_id);

CREATE POLICY "Admin gestiona inscripciones del club"
  ON public.inscripciones FOR ALL TO authenticated
  USING (
    club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

-- ── invitados ─────────────────────────────────────────────────────────────────

CREATE POLICY "Club members access invitados"
  ON public.invitados FOR ALL TO authenticated
  USING (club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()));

-- ── equipos ───────────────────────────────────────────────────────────────────

CREATE POLICY "Club members leen equipos"
  ON public.equipos FOR SELECT TO authenticated
  USING (club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Admin gestiona equipos del club"
  ON public.equipos FOR ALL TO authenticated
  USING (
    club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

-- ── equipo_jugadores ──────────────────────────────────────────────────────────

CREATE POLICY "Club members leen equipo_jugadores"
  ON public.equipo_jugadores FOR ALL TO authenticated
  USING (club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()));

-- ── push_subscriptions ────────────────────────────────────────────────────────

CREATE POLICY "Own push subscriptions"
  ON public.push_subscriptions FOR ALL TO authenticated
  USING (player_id = auth.uid());

-- ── player_knowledge ──────────────────────────────────────────────────────────

CREATE POLICY "Admin ve player_knowledge del club"
  ON public.player_knowledge FOR ALL TO authenticated
  USING (
    club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

-- ── balancer_feedback ─────────────────────────────────────────────────────────

CREATE POLICY "Admin ve balancer_feedback del club"
  ON public.balancer_feedback FOR ALL TO authenticated
  USING (
    club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

-- ── votos_reconocimiento ──────────────────────────────────────────────────────

CREATE POLICY "Club members votan"
  ON public.votos_reconocimiento FOR ALL TO authenticated
  USING (club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()));

-- ── player_badges ─────────────────────────────────────────────────────────────

CREATE POLICY "Ver badges del club"
  ON public.player_badges FOR SELECT TO authenticated
  USING (club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Admin gestiona badges del club"
  ON public.player_badges FOR ALL TO authenticated
  USING (
    club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

-- ── evaluaciones_carta ────────────────────────────────────────────────────────

CREATE POLICY "Player ve propia carta"
  ON public.evaluaciones_carta FOR SELECT TO authenticated
  USING (auth.uid() = player_id);

CREATE POLICY "Cartas aprobadas visibles al club"
  ON public.evaluaciones_carta FOR SELECT TO authenticated
  USING (
    aprobado = true
    AND club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND aprobado = true AND NOT baneado
    )
  );

CREATE POLICY "Player inserta propia carta"
  ON public.evaluaciones_carta FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = player_id);

CREATE POLICY "Player actualiza carta (antes de aprobar)"
  ON public.evaluaciones_carta FOR UPDATE TO authenticated
  USING (auth.uid() = player_id AND aprobado = false AND rechazado = false);

CREATE POLICY "Admin gestiona cartas del club"
  ON public.evaluaciones_carta FOR ALL TO authenticated
  USING (
    club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

-- ── activity_log ──────────────────────────────────────────────────────────────

CREATE POLICY "Admin ve activity_log del club"
  ON public.activity_log FOR ALL TO authenticated
  USING (
    club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

-- ── notificaciones_pendientes ─────────────────────────────────────────────────

CREATE POLICY "Admin ve notificaciones del club"
  ON public.notificaciones_pendientes FOR ALL TO authenticated
  USING (
    club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

-- ── bug_reports ───────────────────────────────────────────────────────────────
-- Superadmin can read all; authenticated users can insert their own.

CREATE POLICY "Superadmin ve todos los bug reports"
  ON public.bug_reports FOR SELECT TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'superadmin');

CREATE POLICY "Authenticated user inserts bug report"
  ON public.bug_reports FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Superadmin updates bug report"
  ON public.bug_reports FOR UPDATE TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'superadmin');


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 20: Functions & Triggers
-- ══════════════════════════════════════════════════════════════════════════════

-- ── handle_new_user: create profile row on signup (club-aware) ────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_club_id uuid;
BEGIN
  -- Read club_id from auth metadata; fall back to MBA FC
  v_club_id := COALESCE(
    (new.raw_user_meta_data->>'club_id')::uuid,
    'a0000000-0000-0000-0000-000000000001'::uuid
  );

  INSERT INTO public.profiles (
    id,
    email,
    username,
    ip_registro,
    club_id,
    role,
    aprobado
  ) VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'ip_registro',
    v_club_id,
    'player',
    false
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── inscribir_jugador: enroll player with confirmado/espera logic ─────────────

CREATE OR REPLACE FUNCTION public.inscribir_jugador(
  p_partido_id uuid,
  p_jugador_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_confirmados        int;
  v_cupos              int;
  v_max_espera         int;
  v_partido            record;
  v_jugador            record;
  v_nueva_inscripcion  record;
BEGIN
  SELECT * INTO v_partido FROM public.partidos WHERE id = p_partido_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Partido no encontrado');
  END IF;
  IF NOT v_partido.inscripcion_abierta THEN
    RETURN json_build_object('error', 'Inscripción no está abierta');
  END IF;

  SELECT * INTO v_jugador FROM public.profiles WHERE id = p_jugador_id;
  IF v_jugador.baneado THEN
    RETURN json_build_object('error', 'Jugador baneado');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inscripciones
    WHERE partido_id = p_partido_id AND player_id = p_jugador_id
      AND estado IN ('confirmado', 'espera')
  ) THEN
    RETURN json_build_object('error', 'Ya estás inscrito en este partido');
  END IF;

  SELECT count(*) INTO v_confirmados
  FROM public.inscripciones
  WHERE partido_id = p_partido_id AND estado = 'confirmado';

  IF v_confirmados < v_partido.cupos_total THEN
    INSERT INTO public.inscripciones (club_id, partido_id, player_id, estado)
    VALUES (v_partido.club_id, p_partido_id, p_jugador_id, 'confirmado')
    RETURNING * INTO v_nueva_inscripcion;
    RETURN json_build_object('estado', 'confirmado', 'id', v_nueva_inscripcion.id);
  ELSE
    SELECT COALESCE(MAX(posicion_espera), 0) + 1 INTO v_max_espera
    FROM public.inscripciones
    WHERE partido_id = p_partido_id AND estado = 'espera';

    INSERT INTO public.inscripciones (club_id, partido_id, player_id, estado, posicion_espera)
    VALUES (v_partido.club_id, p_partido_id, p_jugador_id, 'espera', v_max_espera)
    RETURNING * INTO v_nueva_inscripcion;
    RETURN json_build_object('estado', 'espera', 'posicion', v_max_espera, 'id', v_nueva_inscripcion.id);
  END IF;
END;
$$;

-- ── cancelar_inscripcion: cancel + promote first in waiting list ──────────────

CREATE OR REPLACE FUNCTION public.cancelar_inscripcion(
  p_inscripcion_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inscripcion      record;
  v_primero_espera   record;
BEGIN
  SELECT * INTO v_inscripcion FROM public.inscripciones WHERE id = p_inscripcion_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Inscripción no encontrada');
  END IF;

  UPDATE public.inscripciones SET estado = 'cancelado' WHERE id = p_inscripcion_id;

  IF v_inscripcion.estado = 'confirmado' THEN
    SELECT * INTO v_primero_espera
    FROM public.inscripciones
    WHERE partido_id = v_inscripcion.partido_id AND estado = 'espera'
    ORDER BY posicion_espera ASC
    LIMIT 1;

    IF FOUND THEN
      UPDATE public.inscripciones
      SET estado = 'confirmado', posicion_espera = null
      WHERE id = v_primero_espera.id;

      UPDATE public.inscripciones
      SET posicion_espera = posicion_espera - 1
      WHERE partido_id = v_inscripcion.partido_id AND estado = 'espera';

      RETURN json_build_object('ok', true, 'promovido', v_primero_espera.player_id);
    END IF;
  END IF;

  RETURN json_build_object('ok', true, 'promovido', null);
END;
$$;

-- ── promover_espera: promote first waiting player (used by RPC) ───────────────

CREATE OR REPLACE FUNCTION public.promover_espera(p_partido_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_primero record;
BEGIN
  SELECT * INTO v_primero
  FROM public.inscripciones
  WHERE partido_id = p_partido_id AND estado = 'espera'
  ORDER BY posicion_espera ASC
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.inscripciones
    SET estado = 'confirmado', posicion_espera = null
    WHERE id = v_primero.id;

    UPDATE public.inscripciones
    SET posicion_espera = posicion_espera - 1
    WHERE partido_id = p_partido_id AND estado = 'espera';
  END IF;
END;
$$;

-- ── siguiente_posicion_espera: next available espera slot ─────────────────────

CREATE OR REPLACE FUNCTION public.siguiente_posicion_espera(p_partido_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_max integer;
BEGIN
  SELECT COALESCE(MAX(posicion_espera), 0) + 1 INTO v_max
  FROM public.inscripciones
  WHERE partido_id = p_partido_id AND estado = 'espera';
  RETURN v_max;
END;
$$;

-- ── generar_partidos_proximos: club-aware, any day of week ────────────────────

CREATE OR REPLACE FUNCTION public.generar_partidos_proximos(
  p_club_id    uuid,
  p_dias_juego text[]  DEFAULT ARRAY['martes', 'viernes'],
  p_semanas    integer DEFAULT 8
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_fecha      date;
  v_dia        integer;
  v_dia_nombre text;
  -- Spanish day names indexed by DOW (0=Sunday)
  v_dias_nombres text[] := ARRAY['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
BEGIN
  FOR i IN 0..(p_semanas * 7) LOOP
    v_fecha      := current_date + i;
    v_dia        := extract(dow FROM v_fecha);
    v_dia_nombre := v_dias_nombres[v_dia + 1];

    IF v_dia_nombre = ANY(p_dias_juego) THEN
      INSERT INTO public.partidos (club_id, fecha, dia_semana)
      VALUES (p_club_id, v_fecha, v_dia_nombre)
      ON CONFLICT (club_id, fecha) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

-- ── actualizar_inscripciones_abiertas: time-based open/close ─────────────────
-- Call via pg_cron or manually. Now uses club-specific apertura config.

CREATE OR REPLACE FUNCTION public.actualizar_inscripciones_abiertas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now  timestamptz := now() AT TIME ZONE 'America/Bogota';
  v_rec  record;
BEGIN
  -- Open partidos whose apertura window has arrived and aren't yet open
  FOR v_rec IN
    SELECT p.id
    FROM public.partidos p
    WHERE p.inscripcion_abierta = false
      AND p.fecha >= current_date
      AND (current_date + p.hora_apertura::interval) <=
          (p.fecha - (p.dias_antes_apertura || ' days')::interval + p.hora_apertura::interval)
      AND v_now::time >= p.hora_apertura
  LOOP
    UPDATE public.partidos SET inscripcion_abierta = true WHERE id = v_rec.id;
  END LOOP;

  -- Close partidos that have already been played
  UPDATE public.partidos SET inscripcion_abierta = false
  WHERE fecha < current_date AND inscripcion_abierta = true;
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- SECTION 21: Additional Indexes
-- ══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_inscripciones_partido ON public.inscripciones(partido_id);
CREATE INDEX IF NOT EXISTS idx_inscripciones_player  ON public.inscripciones(player_id);
CREATE INDEX IF NOT EXISTS idx_votos_partido          ON public.votos_reconocimiento(partido_id);
CREATE INDEX IF NOT EXISTS idx_badges_player          ON public.player_badges(player_id);
CREATE INDEX IF NOT EXISTS idx_badges_partido         ON public.player_badges(partido_id);


-- ══════════════════════════════════════════════════════════════════════════════
-- END OF SCHEMA
-- ══════════════════════════════════════════════════════════════════════════════
