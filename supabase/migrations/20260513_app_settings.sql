-- ── App-wide admin settings ────────────────────────────────────────────────
-- Simple key→jsonb store for runtime toggles configurable from admin panel.
-- All reads/writes go through the service-role API; no RLS needed.

create table if not exists public.app_settings (
  key         text        primary key,
  value       jsonb       not null default 'true',
  updated_at  timestamptz default now(),
  updated_by  uuid        references public.profiles(id) on delete set null
);

-- Seed default notification toggles (do nothing on conflict — preserves admin edits)
insert into public.app_settings (key, value) values
  ('notif_apertura',     'true'),
  ('notif_recordatorio', 'true'),
  ('notif_cupos',        'true'),
  ('notif_invitados',    'true')
on conflict (key) do nothing;
