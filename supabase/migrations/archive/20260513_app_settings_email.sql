-- Add email notification toggles to app_settings
insert into public.app_settings (key, value) values
  ('email_apertura',     'true'),
  ('email_recordatorio', 'true')
on conflict (key) do nothing;
