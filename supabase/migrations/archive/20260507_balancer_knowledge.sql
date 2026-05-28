-- ── Player knowledge base (seeded from ChatGPT context) ──────────────────
create table if not exists player_knowledge (
  id           uuid primary key default gen_random_uuid(),
  username     text unique not null,
  skill_override text,         -- 'high' | 'medium' | 'unknown'
  roles        text[] default '{}',
  traits       text[] default '{}',
  notes        text   default '',
  updated_at   timestamptz default now()
);

-- RLS: readable by any authenticated user, writable only by service role
alter table player_knowledge enable row level security;
create policy "authenticated read player_knowledge"
  on player_knowledge for select
  using (auth.role() = 'authenticated');

-- ── Balancer feedback loop ─────────────────────────────────────────────────
create table if not exists balancer_feedback (
  id         uuid primary key default gen_random_uuid(),
  feedback   text not null,
  admin_id   uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

alter table balancer_feedback enable row level security;
create policy "authenticated read balancer_feedback"
  on balancer_feedback for select
  using (auth.role() = 'authenticated');

-- ── Seed: 33 players from ChatGPT knowledge base ──────────────────────────
insert into player_knowledge (username, skill_override, roles, traits, notes) values
  ('yola0',       'medium',  array['goalkeeper','defense'],    array['defensive awareness'],              'ha jugado arquero y defensa'),
  ('molina2',     'medium',  array['defense'],                 array['physical'],                         'perfil defensivo'),
  ('danielb3',    'medium',  array['defense','midfield'],      array[]::text[],                           ''),
  ('zafra4',      'unknown', array[]::text[],                  array[]::text[],                           ''),
  ('marin5',      'medium',  array['midfield'],                array[]::text[],                           'corresponde a Daniel M'),
  ('albarracin6', 'unknown', array[]::text[],                  array[]::text[],                           ''),
  ('vargas7',     'medium',  array['defense','midfield'],      array['physical'],                         ''),
  ('melo8',       'high',    array['midfield'],                array['ball control','creative'],           'uno de los jugadores más técnicos'),
  ('juli9',       'medium',  array['forward'],                 array['attacking'],                        ''),
  ('mauricio10',  'unknown', array[]::text[],                  array[]::text[],                           ''),
  ('aizaga11',    'medium',  array['defense'],                 array['good first touch'],                 ''),
  ('csanchez12',  'medium',  array['midfield'],                array['balanced'],                         'Cristian'),
  ('hernan14',    'medium',  array['defense'],                 array['very physical','aggressive defense'],'defensa fuerte'),
  ('alexis16',    'unknown', array[]::text[],                  array[]::text[],                           ''),
  ('jsanchez17',  'medium',  array['midfield'],                array[]::text[],                           'Jordan'),
  ('samith18',    'medium',  array['forward'],                 array['attacking mindset'],                'le gusta jugar arriba'),
  ('kevin19',     'medium',  array['defense'],                 array['strong defense'],                   'defensa hacha'),
  ('andresi20',   'medium',  array['midfield'],                array[]::text[],                           ''),
  ('jj21',        'medium',  array['midfield'],                array[]::text[],                           ''),
  ('pipes22',     'medium',  array['goalkeeper','defense'],    array['good shot'],                        'a veces juega arquero por lesión'),
  ('jhonsito23',  'medium',  array['midfield'],                array[]::text[],                           'Jhon Gomez'),
  ('berna24',     'medium',  array['forward'],                 array['strong shot'],                      'pegada fuerte'),
  ('andres27',    'medium',  array['midfield'],                array['good shot'],                        'Andres R'),
  ('jbravo30',    'medium',  array['forward'],                 array[]::text[],                           'Juan David'),
  ('montes31',    'unknown', array[]::text[],                  array[]::text[],                           ''),
  ('mati33',      'medium',  array['midfield','forward'],      array['plays well with magic'],            ''),
  ('ferney37',    'unknown', array[]::text[],                  array[]::text[],                           ''),
  ('guerrero44',  'unknown', array[]::text[],                  array[]::text[],                           'Hamilton'),
  ('mendieta69',  'unknown', array[]::text[],                  array[]::text[],                           ''),
  ('magic70',     'high',    array['midfield','forward'],      array['creative','ball control'],           'jugador habilidoso'),
  ('serazo73',    'medium',  array['goalkeeper'],              array[]::text[],                           'Santiago E, arquero'),
  ('sandoval77',  'unknown', array[]::text[],                  array[]::text[],                           'Yonier'),
  ('ortiz97',     'unknown', array[]::text[],                  array['physically strong','strong shot'],  'Fisicamente fuerte, disparo fuerte')
on conflict (username) do update set
  skill_override = excluded.skill_override,
  roles          = excluded.roles,
  traits         = excluded.traits,
  notes          = excluded.notes,
  updated_at     = now();

-- ── Seed initial feedback from ChatGPT context ────────────────────────────
insert into balancer_feedback (feedback) values
  ('Magic (magic70) y Mati (mati33) son padre e hijo — siempre ponerlos en el mismo equipo'),
  ('melo8 es uno de los jugadores más técnicos del grupo — distribuir bien su impacto'),
  ('hernan14 es defensa muy físico y agresivo — no juntar con otro defensa del mismo perfil si es posible'),
  ('samith18 prefiere jugar de delantero, respetar esa posición'),
  ('serazo73 es el arquero designado — priorizar como portero de uno de los equipos'),
  ('pipes22 puede jugar de arquero en caso de lesión — segundo portero disponible');
