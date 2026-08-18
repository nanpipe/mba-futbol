-- ── Rotation + color columns on equipos ─────────────────────────────────
alter table equipos
  add column if not exists color           text    default null,
  add column if not exists portero_fijo    boolean default false,
  add column if not exists rotacion_banca  text[]  default '{}',
  add column if not exists rotacion_portero text[] default '{}';
