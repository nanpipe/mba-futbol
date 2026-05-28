-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 1: Multi-tenant foundation
-- Adds clubs table + club_id to all tables + RLS rewrite
-- Safe for production: nullable first → backfill → NOT NULL
--
-- MBA FC becomes first tenant (fixed UUID: a0000000-0000-0000-0000-000000000001)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. clubs table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clubs (
  id                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                          text        NOT NULL,
  slug                            text        NOT NULL UNIQUE,  -- used as subdomain
  timezone                        text        NOT NULL DEFAULT 'America/Bogota',
  plan                            text        NOT NULL DEFAULT 'basico'
                                              CHECK (plan IN ('gratis', 'basico', 'pro')),
  subscription_status             text        NOT NULL DEFAULT 'active'
                                              CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled')),
  stripe_customer_id              text,
  stripe_subscription_id          text,
  ciudad                          text,
  logo_url                        text,
  color_primary                   text        DEFAULT '#22c55e',
  dias_juego                      text[]      DEFAULT '{}',
  hora_default                    time        DEFAULT '19:00:00',
  hora_apertura_default           time        DEFAULT '10:00:00',
  dias_antes_apertura_default     integer     DEFAULT 2,
  created_at                      timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Seed MBA FC as first tenant ─────────────────────────────────────────
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

-- ── 3. Add club_id columns (nullable first — safe for production) ───────────
ALTER TABLE public.profiles               ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id);
ALTER TABLE public.partidos               ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id);
ALTER TABLE public.inscripciones          ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id);
ALTER TABLE public.invitados              ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id);
ALTER TABLE public.push_subscriptions     ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id);
ALTER TABLE public.equipos                ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id);
ALTER TABLE public.equipo_jugadores       ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id);
ALTER TABLE public.player_knowledge       ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id);
ALTER TABLE public.balancer_feedback      ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id);
ALTER TABLE public.votos_reconocimiento   ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id);
ALTER TABLE public.player_badges          ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id);
ALTER TABLE public.activity_log           ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id);
ALTER TABLE public.notificaciones_pendientes ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id);
ALTER TABLE public.evaluaciones_carta     ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id);

-- ── 4. Backfill all existing rows → MBA FC ──────────────────────────────────
UPDATE public.profiles               SET club_id = 'a0000000-0000-0000-0000-000000000001' WHERE club_id IS NULL;
UPDATE public.partidos               SET club_id = 'a0000000-0000-0000-0000-000000000001' WHERE club_id IS NULL;
UPDATE public.inscripciones          SET club_id = 'a0000000-0000-0000-0000-000000000001' WHERE club_id IS NULL;
UPDATE public.invitados              SET club_id = 'a0000000-0000-0000-0000-000000000001' WHERE club_id IS NULL;
UPDATE public.push_subscriptions     SET club_id = 'a0000000-0000-0000-0000-000000000001' WHERE club_id IS NULL;
UPDATE public.equipos                SET club_id = 'a0000000-0000-0000-0000-000000000001' WHERE club_id IS NULL;
UPDATE public.equipo_jugadores       SET club_id = 'a0000000-0000-0000-0000-000000000001' WHERE club_id IS NULL;
UPDATE public.player_knowledge       SET club_id = 'a0000000-0000-0000-0000-000000000001' WHERE club_id IS NULL;
UPDATE public.balancer_feedback      SET club_id = 'a0000000-0000-0000-0000-000000000001' WHERE club_id IS NULL;
UPDATE public.votos_reconocimiento   SET club_id = 'a0000000-0000-0000-0000-000000000001' WHERE club_id IS NULL;
UPDATE public.player_badges          SET club_id = 'a0000000-0000-0000-0000-000000000001' WHERE club_id IS NULL;
UPDATE public.activity_log           SET club_id = 'a0000000-0000-0000-0000-000000000001' WHERE club_id IS NULL;
UPDATE public.notificaciones_pendientes SET club_id = 'a0000000-0000-0000-0000-000000000001' WHERE club_id IS NULL;
UPDATE public.evaluaciones_carta     SET club_id = 'a0000000-0000-0000-0000-000000000001' WHERE club_id IS NULL;

-- ── 5. Make club_id NOT NULL ────────────────────────────────────────────────
ALTER TABLE public.profiles               ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE public.partidos               ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE public.inscripciones          ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE public.invitados              ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE public.push_subscriptions     ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE public.equipos                ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE public.equipo_jugadores       ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE public.player_knowledge       ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE public.balancer_feedback      ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE public.votos_reconocimiento   ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE public.player_badges          ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE public.activity_log           ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE public.notificaciones_pendientes ALTER COLUMN club_id SET NOT NULL;
ALTER TABLE public.evaluaciones_carta     ALTER COLUMN club_id SET NOT NULL;

-- ── 6. Fix unique constraints for multi-tenancy ─────────────────────────────
-- partidos.fecha was globally unique — now unique per club
ALTER TABLE public.partidos DROP CONSTRAINT IF EXISTS partidos_fecha_key;
ALTER TABLE public.partidos ADD CONSTRAINT partidos_fecha_club_key UNIQUE (club_id, fecha);

-- player_knowledge.username was globally unique — now unique per club
ALTER TABLE public.player_knowledge DROP CONSTRAINT IF EXISTS player_knowledge_username_key;
ALTER TABLE public.player_knowledge ADD CONSTRAINT player_knowledge_username_club_key UNIQUE (club_id, username);

-- Remove hardcoded Tue/Fri constraint — each club sets their own days
ALTER TABLE public.partidos DROP CONSTRAINT IF EXISTS partidos_dia_semana_check;

-- ── 7. app_settings: scope to club ──────────────────────────────────────────
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id);
UPDATE public.app_settings SET club_id = 'a0000000-0000-0000-0000-000000000001' WHERE club_id IS NULL;
ALTER TABLE public.app_settings DROP CONSTRAINT IF EXISTS app_settings_pkey;
ALTER TABLE public.app_settings ADD PRIMARY KEY (club_id, key);

-- ── 8. Indexes ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_profiles_club              ON public.profiles(club_id);
CREATE INDEX IF NOT EXISTS idx_partidos_club              ON public.partidos(club_id);
CREATE INDEX IF NOT EXISTS idx_inscripciones_club         ON public.inscripciones(club_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_club    ON public.push_subscriptions(club_id);
CREATE INDEX IF NOT EXISTS idx_equipos_club               ON public.equipos(club_id);
CREATE INDEX IF NOT EXISTS idx_player_knowledge_club      ON public.player_knowledge(club_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_club          ON public.activity_log(club_id);
CREATE INDEX IF NOT EXISTS idx_evaluaciones_carta_club    ON public.evaluaciones_carta(club_id);
CREATE INDEX IF NOT EXISTS idx_notificaciones_club        ON public.notificaciones_pendientes(club_id);
CREATE INDEX IF NOT EXISTS idx_player_badges_club         ON public.player_badges(club_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS REWRITE
-- Pattern: users see data from their own club only.
-- Superadmin bypasses all club scoping.
-- ═══════════════════════════════════════════════════════════════════════════

-- Helper: resolve caller's club_id once (avoid repeated subqueries)
-- Used inline as: (SELECT club_id FROM public.profiles WHERE id = auth.uid())
-- Used inline as: (SELECT role    FROM public.profiles WHERE id = auth.uid())

-- ── clubs ───────────────────────────────────────────────────────────────────
ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;

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

-- ── profiles ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Usuario ve su propio perfil"       ON public.profiles;
DROP POLICY IF EXISTS "Admin ve todos los perfiles"       ON public.profiles;
DROP POLICY IF EXISTS "Lectura de perfiles"               ON public.profiles;
DROP POLICY IF EXISTS "Usuario actualiza su propio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Admin actualiza cualquier perfil"  ON public.profiles;
DROP POLICY IF EXISTS "Admin actualiza perfiles"          ON public.profiles;
DROP POLICY IF EXISTS "Insert propio perfil"              ON public.profiles;

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

-- ── partidos ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Todos leen partidos"       ON public.partidos;
DROP POLICY IF EXISTS "Solo admin modifica partidos" ON public.partidos;

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

-- ── inscripciones ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Todos leen inscripciones"           ON public.inscripciones;
DROP POLICY IF EXISTS "Usuario se inscribe a sí mismo"     ON public.inscripciones;
DROP POLICY IF EXISTS "Usuario cancela su inscripción"     ON public.inscripciones;
DROP POLICY IF EXISTS "Admin gestiona todas las inscripciones" ON public.inscripciones;

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

-- ── notificaciones_pendientes ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Solo admin y service role ven notificaciones" ON public.notificaciones_pendientes;

CREATE POLICY "Admin ve notificaciones del club"
  ON public.notificaciones_pendientes FOR ALL TO authenticated
  USING (
    club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

-- ── player_badges ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin full access on player_badges" ON public.player_badges;

ALTER TABLE public.player_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver badges del club"
  ON public.player_badges FOR SELECT TO authenticated
  USING (club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Admin gestiona badges del club"
  ON public.player_badges FOR ALL TO authenticated
  USING (
    club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

-- ── evaluaciones_carta ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "player sees own carta"                ON public.evaluaciones_carta;
DROP POLICY IF EXISTS "approved cartas visible to all members" ON public.evaluaciones_carta;
DROP POLICY IF EXISTS "player inserts own carta"             ON public.evaluaciones_carta;
DROP POLICY IF EXISTS "player updates own carta (only before approved)" ON public.evaluaciones_carta;

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

-- ── Tables without RLS — enable + scope ──────────────────────────────────────
ALTER TABLE public.invitados            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipo_jugadores     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_knowledge     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.balancer_feedback    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votos_reconocimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Club members access invitados"
  ON public.invitados FOR ALL TO authenticated
  USING (club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Own push subscriptions"
  ON public.push_subscriptions FOR ALL TO authenticated
  USING (player_id = auth.uid());

CREATE POLICY "Club members leen equipos"
  ON public.equipos FOR SELECT TO authenticated
  USING (club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Admin gestiona equipos del club"
  ON public.equipos FOR ALL TO authenticated
  USING (
    club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

CREATE POLICY "Club members leen equipo_jugadores"
  ON public.equipo_jugadores FOR ALL TO authenticated
  USING (club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Admin ve player_knowledge del club"
  ON public.player_knowledge FOR ALL TO authenticated
  USING (
    club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

CREATE POLICY "Admin ve balancer_feedback del club"
  ON public.balancer_feedback FOR ALL TO authenticated
  USING (
    club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

CREATE POLICY "Club members votan"
  ON public.votos_reconocimiento FOR ALL TO authenticated
  USING (club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Admin ve activity_log del club"
  ON public.activity_log FOR ALL TO authenticated
  USING (
    club_id = (SELECT club_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'superadmin')
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- Update generar_partidos_proximos() — now club-aware, any day of week
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.generar_partidos_proximos(
  p_club_id   uuid,
  p_dias_juego text[] DEFAULT ARRAY['martes', 'viernes'],
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
    v_dia        := extract(dow from v_fecha);
    v_dia_nombre := v_dias_nombres[v_dia + 1];

    IF v_dia_nombre = ANY(p_dias_juego) THEN
      INSERT INTO public.partidos (club_id, fecha, dia_semana)
      VALUES (p_club_id, v_fecha, v_dia_nombre)
      ON CONFLICT (club_id, fecha) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

-- Regenerate MBA FC partidos with new function signature
SELECT public.generar_partidos_proximos('a0000000-0000-0000-0000-000000000001', ARRAY['martes', 'viernes'], 8);

-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT 'clubs' AS tbl, count(*) FROM public.clubs
UNION ALL SELECT 'profiles', count(*) FROM public.profiles WHERE club_id IS NOT NULL
UNION ALL SELECT 'partidos', count(*) FROM public.partidos WHERE club_id IS NOT NULL;
