-- backend/db/schema.sql
-- Ejecutar en el SQL editor de Supabase.

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  avatar_emoji text not null
);

create table movies (
  id uuid primary key default gen_random_uuid(),
  tmdb_id integer unique,
  title text not null,
  original_title text,
  year integer,
  poster_url text,
  director text,
  "cast" jsonb,
  runtime integer,
  genres jsonb,
  overview text,
  tmdb_rating numeric,
  country text,
  enriched boolean not null default false,
  -- clave de cache para resolver título+año sin re-pedir a TMDB
  search_key text unique
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  mode text not null default 'pool',
  active boolean not null default true,
  started_by text,
  created_at timestamptz not null default now()
);

create table watchlist_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  user_id uuid not null references users(id),
  movie_id uuid not null references movies(id),
  unique (session_id, user_id, movie_id)
);

create table swipes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  user_id uuid not null references users(id),
  movie_id uuid not null references movies(id),
  liked boolean not null,
  created_at timestamptz not null default now(),
  unique (session_id, user_id, movie_id)
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  movie_id uuid not null references movies(id),
  created_at timestamptz not null default now(),
  unique (session_id, movie_id)
);

-- Seed: las dos usuarias fijas
insert into users (name, avatar_emoji) values ('Jo', '🐭'), ('Vale', '🦆');

-- RLS: la anon key (frontend) solo puede LEER movies y matches.
-- swipes y watchlist_items quedan inaccesibles para anon => privacidad de likes.
alter table users enable row level security;
alter table movies enable row level security;
alter table sessions enable row level security;
alter table watchlist_items enable row level security;
alter table swipes enable row level security;
alter table matches enable row level security;

create policy "anon lee users" on users for select to anon using (true);
create policy "anon lee movies" on movies for select to anon using (true);
create policy "anon lee sessions" on sessions for select to anon using (true);
create policy "anon lee matches" on matches for select to anon using (true);
-- swipes y watchlist_items: SIN policy para anon => nadie con anon key los lee.
-- El backend usa la service role key, que ignora RLS.

-- Realtime: publicar matches para suscripción en vivo
alter publication supabase_realtime add table matches;

-- ─────────────────────────────────────────────────────────────
-- Migración bloque crítico (2026-06-23) — idempotente.
-- Aplicar sobre la DB ya existente sin recrear tablas.
-- ─────────────────────────────────────────────────────────────

-- 1) Dejar UNA sola sesión activa antes de crear el índice único.
update sessions set active = false
where active and id <> (
  select id from sessions where active order by created_at desc limit 1
);

-- 2) Garantizar una sola sesión activa de ahí en adelante.
create unique index if not exists one_active_session on sessions (active) where active;

-- 3) Quién inició la noche (para el aviso en vivo).
alter table sessions add column if not exists started_by text;

-- 4) Publicar sessions en Realtime para detectar nuevas sesiones.
alter publication supabase_realtime add table sessions;
