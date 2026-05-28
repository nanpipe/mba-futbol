-- ── Track which team each invitado is on ──────────────────────────────────
alter table invitados
  add column if not exists equipo_id uuid references equipos(id) on delete set null;

-- ── Store the specific fixed goalkeeper per team ───────────────────────────
alter table equipos
  add column if not exists portero_fijo_id text default null;
