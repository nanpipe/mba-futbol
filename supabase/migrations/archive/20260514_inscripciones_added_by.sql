-- Track which admin manually added a player to a partido
alter table public.inscripciones
  add column if not exists added_by uuid references public.profiles(id) on delete set null;
