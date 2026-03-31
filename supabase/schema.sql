-- ============================================
-- MBA FUTBOL CLUB - SUPABASE SCHEMA
-- Ejecutar en: Supabase > SQL Editor
-- ============================================

-- Extensión para UUIDs
create extension if not exists "uuid-ossp";

-- ============================================
-- TABLA: profiles
-- Extiende auth.users de Supabase
-- ============================================
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  username text unique not null,
  email text unique not null,
  ip_registro text,
  role text not null default 'player' check (role in ('player', 'admin')),
  baneado boolean not null default false,
  fecha_ban timestamptz,
  fecha_liberacion timestamptz,
  razon_ban text,
  created_at timestamptz not null default now()
);

-- RLS
alter table public.profiles enable row level security;

create policy "Usuarios ven su propio perfil"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Admin ve todos los perfiles"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

create policy "Admin actualiza perfiles"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- ============================================
-- TABLA: partidos
-- Martes y viernes, generados automáticamente
-- ============================================
create table public.partidos (
  id uuid primary key default uuid_generate_v4(),
  fecha date not null unique,
  dia_semana text not null check (dia_semana in ('martes', 'viernes')),
  hora time not null default '19:00:00',
  cupos_totales int not null default 14,
  inscripcion_abierta boolean not null default false,
  created_at timestamptz not null default now()
);

-- RLS
alter table public.partidos enable row level security;

create policy "Todos pueden ver partidos"
  on public.partidos for select
  using (true);

create policy "Solo admin modifica partidos"
  on public.partidos for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- ============================================
-- TABLA: inscripciones
-- ============================================
create table public.inscripciones (
  id uuid primary key default uuid_generate_v4(),
  partido_id uuid references public.partidos(id) on delete cascade not null,
  jugador_id uuid references public.profiles(id) on delete cascade not null,
  estado text not null default 'confirmado' check (estado in ('confirmado', 'espera', 'cancelado')),
  posicion_espera int, -- null si está confirmado
  created_at timestamptz not null default now(),
  unique(partido_id, jugador_id)
);

-- RLS
alter table public.inscripciones enable row level security;

create policy "Todos ven inscripciones"
  on public.inscripciones for select
  using (true);

create policy "Jugador inscribe o cancela su propia"
  on public.inscripciones for all
  using (auth.uid() = jugador_id);

create policy "Admin gestiona todas las inscripciones"
  on public.inscripciones for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- ============================================
-- FUNCIÓN: inscribir jugador
-- Maneja lógica de confirmado vs espera
-- ============================================
create or replace function public.inscribir_jugador(
  p_partido_id uuid,
  p_jugador_id uuid
)
returns json
language plpgsql
security definer
as $$
declare
  v_confirmados int;
  v_cupos int;
  v_max_espera int;
  v_partido record;
  v_jugador record;
  v_nueva_inscripcion record;
begin
  -- Verificar que el partido existe y la inscripción está abierta
  select * into v_partido from public.partidos where id = p_partido_id;
  if not found then
    return json_build_object('error', 'Partido no encontrado');
  end if;
  if not v_partido.inscripcion_abierta then
    return json_build_object('error', 'Inscripción no está abierta');
  end if;

  -- Verificar que el jugador no está baneado
  select * into v_jugador from public.profiles where id = p_jugador_id;
  if v_jugador.baneado then
    return json_build_object('error', 'Jugador baneado');
  end if;

  -- Verificar que no esté ya inscrito
  if exists (
    select 1 from public.inscripciones
    where partido_id = p_partido_id and jugador_id = p_jugador_id
    and estado in ('confirmado', 'espera')
  ) then
    return json_build_object('error', 'Ya estás inscrito en este partido');
  end if;

  -- Contar confirmados
  select count(*) into v_confirmados
  from public.inscripciones
  where partido_id = p_partido_id and estado = 'confirmado';

  if v_confirmados < v_partido.cupos_totales then
    -- Hay cupo: inscribir como confirmado
    insert into public.inscripciones (partido_id, jugador_id, estado)
    values (p_partido_id, p_jugador_id, 'confirmado')
    returning * into v_nueva_inscripcion;
    return json_build_object('estado', 'confirmado', 'id', v_nueva_inscripcion.id);
  else
    -- Sin cupo: lista de espera
    select coalesce(max(posicion_espera), 0) + 1 into v_max_espera
    from public.inscripciones
    where partido_id = p_partido_id and estado = 'espera';

    insert into public.inscripciones (partido_id, jugador_id, estado, posicion_espera)
    values (p_partido_id, p_jugador_id, 'espera', v_max_espera)
    returning * into v_nueva_inscripcion;
    return json_build_object('estado', 'espera', 'posicion', v_max_espera, 'id', v_nueva_inscripcion.id);
  end if;
end;
$$;

-- ============================================
-- FUNCIÓN: cancelar inscripción + promover espera
-- ============================================
create or replace function public.cancelar_inscripcion(
  p_inscripcion_id uuid
)
returns json
language plpgsql
security definer
as $$
declare
  v_inscripcion record;
  v_primero_espera record;
begin
  select * into v_inscripcion from public.inscripciones where id = p_inscripcion_id;
  if not found then
    return json_build_object('error', 'Inscripción no encontrada');
  end if;

  -- Marcar como cancelado
  update public.inscripciones set estado = 'cancelado' where id = p_inscripcion_id;

  -- Si era confirmado, promover al primero en espera
  if v_inscripcion.estado = 'confirmado' then
    select * into v_primero_espera
    from public.inscripciones
    where partido_id = v_inscripcion.partido_id
      and estado = 'espera'
    order by posicion_espera asc
    limit 1;

    if found then
      update public.inscripciones
      set estado = 'confirmado', posicion_espera = null
      where id = v_primero_espera.id;

      -- Reajustar posiciones de espera restantes
      update public.inscripciones
      set posicion_espera = posicion_espera - 1
      where partido_id = v_inscripcion.partido_id
        and estado = 'espera';

      return json_build_object(
        'ok', true,
        'promovido', v_primero_espera.jugador_id
      );
    end if;
  end if;

  return json_build_object('ok', true, 'promovido', null);
end;
$$;

-- ============================================
-- FUNCIÓN: generar próximos partidos
-- Llamar manualmente o con cron
-- ============================================
create or replace function public.generar_proximos_partidos(semanas int default 4)
returns void
language plpgsql
security definer
as $$
declare
  v_fecha date;
  v_dia int;
  i int;
begin
  for i in 0..(semanas * 7) loop
    v_fecha := current_date + i;
    v_dia := extract(dow from v_fecha); -- 0=domingo, 2=martes, 5=viernes

    if v_dia in (2, 5) then
      insert into public.partidos (fecha, dia_semana)
      values (
        v_fecha,
        case when v_dia = 2 then 'martes' else 'viernes' end
      )
      on conflict (fecha) do nothing;
    end if;
  end loop;
end;
$$;

-- ============================================
-- FUNCIÓN: abrir/cerrar inscripciones automáticamente
-- Llamar con pg_cron cada hora o manualmente
-- Domingo >= 10am: abre martes
-- Jueves >= 10am: abre viernes
-- ============================================
create or replace function public.actualizar_inscripciones_abiertas()
returns void
language plpgsql
security definer
as $$
declare
  v_now timestamptz := now() at time zone 'America/Bogota';
  v_dia int := extract(dow from v_now);
  v_hora time := v_now::time;
  v_proximo_martes date;
  v_proximo_viernes date;
begin
  -- Calcular próximos martes y viernes
  v_proximo_martes := date_trunc('week', current_date) + interval '2 days';
  if v_proximo_martes <= current_date then
    v_proximo_martes := v_proximo_martes + interval '7 days';
  end if;

  v_proximo_viernes := date_trunc('week', current_date) + interval '5 days';
  if v_proximo_viernes <= current_date then
    v_proximo_viernes := v_proximo_viernes + interval '7 days';
  end if;

  -- Domingo (0) >= 10am: abrir martes
  if v_dia = 0 and v_hora >= '10:00' then
    update public.partidos set inscripcion_abierta = true
    where fecha = v_proximo_martes;
  end if;

  -- Jueves (4) >= 10am: abrir viernes
  if v_dia = 4 and v_hora >= '10:00' then
    update public.partidos set inscripcion_abierta = true
    where fecha = v_proximo_viernes;
  end if;

  -- Cerrar partidos ya jugados
  update public.partidos set inscripcion_abierta = false
  where fecha < current_date;
end;
$$;

-- ============================================
-- MIGRACIÓN: ventana de inscripción configurable por partido
-- Ejecutar en Supabase SQL Editor
-- ============================================
-- alter table public.partidos
--   add column if not exists hora_apertura time not null default '10:00:00',
--   add column if not exists dias_antes_apertura int not null default 2;
--
-- También remover el constraint de dia_semana si se quieren permitir otros días:
-- alter table public.partidos drop constraint if exists partidos_dia_semana_check;

-- ============================================
-- TABLA: push_subscriptions
-- Suscripciones de push por navegador/dispositivo
-- ============================================
create table public.push_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  player_id uuid references public.profiles(id) on delete cascade not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique(player_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

create policy "Jugador gestiona sus propias suscripciones"
  on public.push_subscriptions for all
  using (auth.uid() = player_id);

-- ============================================
-- DATOS INICIALES
-- ============================================

-- Generar partidos para las próximas 8 semanas
select public.generar_proximos_partidos(8);
