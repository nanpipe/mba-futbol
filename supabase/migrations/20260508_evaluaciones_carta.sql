-- ── FIFA-style player evaluation cards ──────────────────────────────────────

create table if not exists public.evaluaciones_carta (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid references public.profiles(id) on delete cascade not null,

  -- Raw answers: { res: [1,4,3,2,5], fis: [...], def: [...], ata: [...], tec: [...], dis: [...] }
  answers       jsonb not null default '{}',

  -- Calculated stats (45 + score*2 formula)
  stat_res      integer,
  stat_fis      integer,
  stat_def      integer,
  stat_ata      integer,
  stat_tec      integer,
  stat_dis      integer,
  ovr           integer,
  tier          text,  -- 'bronce_bajo' | 'bronce_alto' | 'plata' | 'oro' | 'crack' | 'leyenda'

  -- Basic info from the form
  posicion_carta text,  -- position shown on card (arquero | defensa | lateral | volante | extremo | delantero)
  pierna        text,   -- 'derecha' | 'izquierda' | 'ambas'

  -- Admin workflow
  aprobado      boolean default false not null,
  aprobado_por  uuid references public.profiles(id),
  aprobado_at   timestamptz,
  notas_admin   text,
  rechazado     boolean default false not null,

  created_at    timestamptz default now() not null,
  updated_at    timestamptz default now() not null,

  unique(player_id)
);

-- RLS: player sees own row; approved cards visible to all authenticated users
alter table public.evaluaciones_carta enable row level security;

create policy "player sees own carta"
  on public.evaluaciones_carta for select
  using (auth.uid() = player_id);

create policy "approved cartas visible to all members"
  on public.evaluaciones_carta for select
  using (
    aprobado = true
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and aprobado = true and not baneado
    )
  );

create policy "player inserts own carta"
  on public.evaluaciones_carta for insert
  with check (auth.uid() = player_id);

create policy "player updates own carta (only before approved)"
  on public.evaluaciones_carta for update
  using (auth.uid() = player_id and aprobado = false and rechazado = false);
