-- Minitorneo support: 3-team format with points-based scoring
alter table public.partidos
  add column if not exists tipo           text    not null default 'normal',  -- 'normal' | 'minitorneo'
  add column if not exists puntos_blanco  integer,
  add column if not exists puntos_negro   integer,
  add column if not exists puntos_morado  integer;  -- null when tipo = 'normal'
