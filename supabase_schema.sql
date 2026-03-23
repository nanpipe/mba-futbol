-- =============================================
-- MBA FUTBOL CLUB — Supabase Schema
-- Ejecutar en: Supabase > SQL Editor
-- =============================================

-- Extensión para UUIDs
create extension if not exists "uuid-ossp";

-- =============================================
-- TABLA: profiles
-- Extiende auth.users de Supabase
-- =============================================
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

-- RLS: cada usuario ve su propio perfil; admin ve todos
alter table public.profiles enable row level security;

create policy "Usuario ve su propio perfil"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Admin ve todos los perfiles"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "Usuario actualiza su propio perfil"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Admin actualiza cualquier perfil"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "Insert propio perfil"
  on public.profiles for insert
  with check (auth.uid() = id);

-- =============================================
-- TABLA: partidos
-- Martes y viernes, generados automáticamente
-- =============================================
create table public.partidos (
  id uuid primary key default uuid_generate_v4(),
  fecha date not null unique,
  dia_semana text not null check (dia_semana in ('martes', 'viernes')),
  hora time not null default '19:00:00',
  cupos_total integer not null default 14,
  inscripcion_abierta boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.partidos enable row level security;

create policy "Todos leen partidos"
  on public.partidos for select
  using (true);

create policy "Solo admin modifica partidos"
  on public.partidos for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- =============================================
-- TABLA: inscripciones
-- =============================================
create table public.inscripciones (
  id uuid primary key default uuid_generate_v4(),
  partido_id uuid references public.partidos(id) on delete cascade not null,
  player_id uuid references public.profiles(id) on delete cascade not null,
  estado text not null default 'confirmado' check (estado in ('confirmado', 'espera')),
  posicion_espera integer, -- null si confirmado, número si en espera
  created_at timestamptz not null default now(),
  unique(partido_id, player_id)
);

alter table public.inscripciones enable row level security;

create policy "Todos leen inscripciones"
  on public.inscripciones for select
  using (true);

create policy "Usuario se inscribe a sí mismo"
  on public.inscripciones for insert
  with check (auth.uid() = player_id);

create policy "Usuario cancela su inscripción"
  on public.inscripciones for delete
  using (auth.uid() = player_id);

create policy "Admin gestiona todas las inscripciones"
  on public.inscripciones for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- =============================================
-- FUNCIÓN: promover_espera
-- Cuando se libera un cupo, promueve al primero en espera
-- =============================================
create or replace function public.promover_espera(p_partido_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_confirmados integer;
  v_cupos_total integer;
  v_siguiente uuid;
  v_siguiente_email text;
  v_siguiente_username text;
  v_fecha_partido date;
begin
  -- Contar confirmados actuales
  select count(*) into v_confirmados
  from public.inscripciones
  where partido_id = p_partido_id and estado = 'confirmado';

  -- Obtener cupos totales y fecha
  select cupos_total, fecha into v_cupos_total, v_fecha_partido
  from public.partidos
  where id = p_partido_id;

  -- Si hay cupo disponible, promover al primero en espera
  if v_confirmados < v_cupos_total then
    select i.player_id into v_siguiente
    from public.inscripciones i
    where i.partido_id = p_partido_id and i.estado = 'espera'
    order by i.posicion_espera asc
    limit 1;

    if v_siguiente is not null then
      -- Promover
      update public.inscripciones
      set estado = 'confirmado', posicion_espera = null
      where partido_id = p_partido_id and player_id = v_siguiente;

      -- Reordenar posiciones de espera restantes
      with ranked as (
        select id, row_number() over (order by posicion_espera asc) as nueva_pos
        from public.inscripciones
        where partido_id = p_partido_id and estado = 'espera'
      )
      update public.inscripciones i
      set posicion_espera = r.nueva_pos
      from ranked r
      where i.id = r.id;

      -- Obtener email y username para notificación
      select email, username into v_siguiente_email, v_siguiente_username
      from public.profiles
      where id = v_siguiente;

      -- Insertar en tabla de notificaciones pendientes
      insert into public.notificaciones_pendientes (player_id, email, username, partido_id, fecha_partido, tipo)
      values (v_siguiente, v_siguiente_email, v_siguiente_username, p_partido_id, v_fecha_partido, 'promovido');
    end if;
  end if;
end;
$$;

-- =============================================
-- TABLA: notificaciones_pendientes
-- Cola para el worker de emails
-- =============================================
create table public.notificaciones_pendientes (
  id uuid primary key default uuid_generate_v4(),
  player_id uuid references public.profiles(id),
  email text not null,
  username text not null,
  partido_id uuid references public.partidos(id),
  fecha_partido date,
  tipo text not null default 'promovido',
  enviado boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notificaciones_pendientes enable row level security;

create policy "Solo admin y service role ven notificaciones"
  on public.notificaciones_pendientes for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- =============================================
-- FUNCIÓN: siguiente_posicion_espera
-- =============================================
create or replace function public.siguiente_posicion_espera(p_partido_id uuid)
returns integer
language sql
as $$
  select coalesce(max(posicion_espera), 0) + 1
  from public.inscripciones
  where partido_id = p_partido_id and estado = 'espera';
$$;

-- =============================================
-- FUNCIÓN: auto-generar partidos próximos
-- Genera partidos para las próximas 8 semanas
-- =============================================
create or replace function public.generar_partidos_proximos()
returns void
language plpgsql
as $$
declare
  v_fecha date;
  v_dia integer;
begin
  -- Generar para las próximas 8 semanas
  for i in 0..55 loop
    v_fecha := current_date + i;
    v_dia := extract(dow from v_fecha); -- 0=domingo, 2=martes, 5=viernes

    if v_dia = 2 then -- martes
      insert into public.partidos (fecha, dia_semana)
      values (v_fecha, 'martes')
      on conflict (fecha) do nothing;
    elsif v_dia = 5 then -- viernes
      insert into public.partidos (fecha, dia_semana)
      values (v_fecha, 'viernes')
      on conflict (fecha) do nothing;
    end if;
  end loop;
end;
$$;

-- Ejecutar para poblar partidos iniciales
select public.generar_partidos_proximos();

-- =============================================
-- TRIGGER: abrir inscripción automáticamente
-- =============================================
-- Nota: La apertura se maneja en la API de Next.js
-- comparando la fecha/hora actual con las reglas:
-- Domingo >= 10am → abre el martes siguiente
-- Jueves >= 10am → abre el viernes siguiente

-- =============================================
-- ÍNDICES
-- =============================================
create index idx_inscripciones_partido on public.inscripciones(partido_id);
create index idx_inscripciones_player on public.inscripciones(player_id);
create index idx_inscripciones_espera on public.inscripciones(partido_id, estado, posicion_espera);
create index idx_partidos_fecha on public.partidos(fecha);
create index idx_notificaciones_pendientes on public.notificaciones_pendientes(enviado, created_at);
