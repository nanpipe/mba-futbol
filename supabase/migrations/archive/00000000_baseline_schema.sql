-- ============================================================
-- BASELINE SCHEMA — MBA Fútbol Club
-- Reconstructed 2026-05-08 from live Supabase (information_schema
-- export) + codebase column references.
--
-- DO NOT run on production — these tables already exist.
-- Use this to recreate from scratch on a new Supabase project.
-- ============================================================

-- ── profiles ─────────────────────────────────────────────────
-- Extends auth.users. Created automatically via trigger on signup.
create table if not exists public.profiles (
  id               uuid         primary key references auth.users on delete cascade,
  username         text         not null,
  email            text         not null,
  ip_registro      text,
  role             text         not null default 'player',   -- 'player' | 'admin'
  baneado          boolean      not null default false,
  aprobado         boolean      not null default false,
  uniform          boolean      not null default false,
  fecha_liberacion text,
  razon_ban        text,
  avatar_url       text,
  posicion         text,
  habilidad        numeric      not null default 3.0,
  created_at       timestamptz  not null default now()
);

-- ── partidos ─────────────────────────────────────────────────
create table if not exists public.partidos (
  id                       uuid        primary key default uuid_generate_v4(),
  fecha                    date        not null,
  dia_semana               text        not null,
  hora                     time        not null default '19:00:00',
  cupos_total              integer     not null default 14,
  inscripcion_abierta      boolean     not null default false,
  hora_apertura            time        not null default '10:00:00',
  dias_antes_apertura      integer     not null default 2,
  notif_apertura_sent      boolean     not null default false,
  notif_recordatorio_sent  boolean     not null default false,
  resultado                text,
  evaluaciones_abiertas    boolean     not null default false,
  equipos_confirmados      boolean     not null default false,
  created_at               timestamptz not null default now()
);

-- ── inscripciones ────────────────────────────────────────────
create table if not exists public.inscripciones (
  id               uuid        primary key default uuid_generate_v4(),
  partido_id       uuid        not null references public.partidos on delete cascade,
  player_id        uuid        not null references public.profiles on delete cascade,
  estado           text        not null default 'confirmado',  -- 'confirmado' | 'espera'
  posicion_espera  integer,
  created_at       timestamptz not null default now(),
  unique (partido_id, player_id)
);

-- ── invitados ────────────────────────────────────────────────
create table if not exists public.invitados (
  id               uuid        primary key default uuid_generate_v4(),
  partido_id       uuid        not null references public.partidos on delete cascade,
  player_id        uuid        not null references public.profiles on delete cascade,
  nombre           varchar     not null,
  estado           text        not null default 'espera',  -- 'espera' | 'confirmado'
  posicion_espera  integer,
  equipo_id        uuid,
  created_at       timestamptz not null default now()
);

-- ── push_subscriptions ───────────────────────────────────────
create table if not exists public.push_subscriptions (
  id          uuid        primary key default gen_random_uuid(),
  player_id   uuid        not null references public.profiles on delete cascade,
  endpoint    text        not null,
  p256dh      text        not null,
  auth        text        not null,
  created_at  timestamptz default now(),
  unique (player_id, endpoint)
);

-- ── equipos ──────────────────────────────────────────────────
create table if not exists public.equipos (
  id               uuid        primary key default gen_random_uuid(),
  partido_id       uuid        not null references public.partidos on delete cascade,
  nombre           text        not null,
  confirmado       boolean     not null default false,
  color            text,
  portero_fijo     boolean     default false,
  portero_fijo_id  text,
  rotacion_banca   text[]      default '{}',
  rotacion_portero text[]      default '{}',
  created_at       timestamptz default now()
);

-- ── equipo_jugadores ─────────────────────────────────────────
create table if not exists public.equipo_jugadores (
  id          uuid        primary key default gen_random_uuid(),
  equipo_id   uuid        not null references public.equipos on delete cascade,
  player_id   uuid        not null references public.profiles on delete cascade,
  created_at  timestamptz default now(),
  unique (equipo_id, player_id)
);

-- ── player_knowledge ─────────────────────────────────────────
-- Admin-curated data used by team balancer AI
create table if not exists public.player_knowledge (
  id              uuid        primary key default gen_random_uuid(),
  username        text        not null unique,
  skill_override  text,
  roles           text[]      default '{}',
  traits          text[]      default '{}',
  notes           text        default '',
  updated_at      timestamptz default now()
);

-- ── balancer_feedback ────────────────────────────────────────
create table if not exists public.balancer_feedback (
  id          uuid        primary key default gen_random_uuid(),
  feedback    text        not null,
  admin_id    uuid        references public.profiles on delete set null,
  created_at  timestamptz default now()
);

-- ── votos_reconocimiento ─────────────────────────────────────
-- One vote per category per voter per match
create table if not exists public.votos_reconocimiento (
  id          uuid        primary key default gen_random_uuid(),
  partido_id  uuid        not null references public.partidos on delete cascade,
  votante_id  uuid        not null references public.profiles on delete cascade,
  votado_id   uuid        not null references public.profiles on delete cascade,
  categoria   text        not null,
  created_at  timestamptz default now(),
  unique (partido_id, votante_id, categoria)
);

-- ── player_badges ────────────────────────────────────────────
create table if not exists public.player_badges (
  id           uuid        primary key default gen_random_uuid(),
  player_id    uuid        not null references public.profiles on delete cascade,
  badge_id     text        not null,
  badge_emoji  text        not null,
  badge_nombre text        not null,
  partido_id   uuid        references public.partidos on delete set null,
  earned_at    timestamptz default now()
);

-- ── activity_log ─────────────────────────────────────────────
create table if not exists public.activity_log (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        references public.profiles on delete set null,
  username    text,
  accion      text        not null,
  detalles    jsonb,
  ip          text,
  created_at  timestamptz default now()
);

-- ── notificaciones_pendientes ────────────────────────────────
-- Queue for "promovido" emails when a waiting-list spot opens
create table if not exists public.notificaciones_pendientes (
  id             uuid        primary key default uuid_generate_v4(),
  player_id      uuid        references public.profiles on delete cascade,
  email          text        not null,
  username       text        not null,
  partido_id     uuid        references public.partidos on delete cascade,
  fecha_partido  date,
  tipo           text        not null default 'promovido',
  enviado        boolean     not null default false,
  created_at     timestamptz not null default now()
);

-- ── evaluaciones_carta ───────────────────────────────────────
-- See 20260508_evaluaciones_carta.sql for full definition + RLS
