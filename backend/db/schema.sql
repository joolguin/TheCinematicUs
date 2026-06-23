-- backend/db/schema.sql
-- Ejecutar en el SQL editor de Supabase.

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  avatar_url text
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

-- Pozo persistente por usuaria (NO scopeado por sesión).
-- Las URLs de watchlist de Letterboxd se configuran por env (LETTERBOXD_URL_JO/_VALE).
create table watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  movie_id uuid not null references movies(id),
  unique (user_id, movie_id)
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

-- Seed: las dos usuarias fijas (avatar_url se llena cuando haya foto)
insert into users (name) values ('Jo'), ('Vale');

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

-- ─────────────────────────────────────────────────────────────
-- Migración avatar (2026-06-23) — idempotente.
-- avatar_emoji → avatar_url (nullable), para reemplazar emojis por fotos.
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'users' and column_name = 'avatar_emoji'
  ) then
    alter table users rename column avatar_emoji to avatar_url;
  end if;
end $$;
alter table users alter column avatar_url drop not null;
update users set avatar_url = null;

-- ─────────────────────────────────────────────────────────────
-- Migración watchlists Letterboxd (2026-06-23) — idempotente.
-- Para una DB EXISTENTE (con watchlist_items viejo scopeado por sesión).
-- En una DB nueva el `create table` de arriba ya deja el estado final;
-- estas sentencias son no-ops idempotentes.
-- Las URLs de Letterboxd van por env (LETTERBOXD_URL_JO/_VALE), no en la DB.
-- ─────────────────────────────────────────────────────────────

-- Desacoplar watchlist_items de sesiones → pozo persistente por usuaria.
alter table watchlist_items drop constraint if exists watchlist_items_session_id_fkey;
-- el set viejo estaba scopeado por sesión; ya no aplica
delete from watchlist_items;
alter table watchlist_items drop column if exists session_id;

-- Nueva unicidad: una fila por (usuaria, película).
create unique index if not exists watchlist_items_user_movie
  on watchlist_items (user_id, movie_id);
