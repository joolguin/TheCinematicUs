-- backend/db/schema.sql
-- Ejecutar en el SQL editor de Supabase.

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  avatar_url text,
  letterboxd_url text
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
  fetched_at timestamptz,
  last_enrich_attempt_at timestamptz,
  -- clave de cache para resolver título+año sin re-pedir a TMDB (NO unique: tmdb_id es la verdad)
  search_key text
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  mode text not null default 'pool',
  active boolean not null default true,
  started_by text,
  filters jsonb,
  filters_updated_by text,
  created_at timestamptz not null default now()
);

-- Pozo persistente por usuaria (NO scopeado por sesión).
-- Las URLs de watchlist de Letterboxd se almacenan en users.letterboxd_url.
create table watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  movie_id uuid not null references movies(id),
  first_seen_at timestamptz not null default now(),
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

-- Estado acumulado por usuaria que cruza sesiones (para ordenar el mazo por
-- novedad). Privado: revela qué pasó/likeó cada usuaria.
create table user_movie_state (
  user_id uuid not null references users(id),
  movie_id uuid not null references movies(id),
  pass_count int not null default 0,
  last_passed_at timestamptz,
  last_liked_at timestamptz,
  primary key (user_id, movie_id)
);

-- Estado del último refresh de watchlists (singleton). El frontend (anon) lo
-- lee por Realtime para saber cuándo terminó. Solo conteos, no likes.
create table refresh_status (
  id int primary key default 1,
  status text not null default 'idle',   -- 'idle' | 'running' | 'done' | 'error'
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb,
  updated_at timestamptz not null default now(),
  constraint refresh_status_singleton check (id = 1)
);
insert into refresh_status (id, status) values (1, 'idle') on conflict (id) do nothing;

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
-- swipes y watchlist_items: DENY explícito para anon (fail-closed visible).
-- El backend usa service role, que ignora RLS.
create policy "anon no lee swipes" on swipes for select to anon using (false);
create policy "anon no lee watchlist_items" on watchlist_items for select to anon using (false);
alter table user_movie_state enable row level security;
create policy "anon no lee user_movie_state" on user_movie_state for select to anon using (false);
alter table refresh_status enable row level security;
create policy "anon lee refresh_status" on refresh_status for select to anon using (true);

-- Realtime: publicar matches para suscripción en vivo
alter publication supabase_realtime add table matches;
alter publication supabase_realtime add table refresh_status;

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

-- ─────────────────────────────────────────────────────────────
-- Migración M1 (2026-06-24): search_key deja de ser unique.
-- Dos pelis distintas con mismo título+año pueden coexistir; la
-- identidad real es tmdb_id (que sigue unique). La lectura de cache
-- usa limit(1), tolerante a duplicados.
-- ─────────────────────────────────────────────────────────────
alter table movies drop constraint if exists movies_search_key_key;
create index if not exists movies_search_key_idx on movies (search_key);

-- ─────────────────────────────────────────────────────────────
-- Migración M1 privacidad (2026-06-24): DENY explícito en vez de
-- ausencia de policy. Fail-closed visible para auditar.
-- ─────────────────────────────────────────────────────────────
drop policy if exists "anon no lee swipes" on swipes;
drop policy if exists "anon no lee watchlist_items" on watchlist_items;
create policy "anon no lee swipes" on swipes for select to anon using (false);
create policy "anon no lee watchlist_items" on watchlist_items for select to anon using (false);

-- ─────────────────────────────────────────────────────────────
-- Migración M1 letterboxd_url (2026-06-24): URLs de watchlist como
-- columna de users (antes en env LETTERBOXD_URL_*). Cambiar URL ya
-- no requiere redeploy. Poblar manualmente:
--   update users set letterboxd_url = '...' where name = 'Jo';
--   update users set letterboxd_url = '...' where name = 'Vale';
-- ─────────────────────────────────────────────────────────────
alter table users add column if not exists letterboxd_url text;

-- ─────────────────────────────────────────────────────────────
-- Migración M1 enrich (2026-06-24): fetched_at (datos válidos cacheados)
-- y last_enrich_attempt_at (último intento) para reintentar las pelis
-- no enriquecidas con ventana fija, en vez de enriched=false permanente.
-- ─────────────────────────────────────────────────────────────
alter table movies add column if not exists fetched_at timestamptz;
alter table movies add column if not exists last_enrich_attempt_at timestamptz;

-- ─────────────────────────────────────────────────────────────
-- Migración M2 filtros (2026-06-24): filtro compartido por sesión.
-- filters (jsonb, null = sin filtro) + filters_updated_by (quién lo
-- tocó, para el aviso en vivo). sessions ya está en la publicación
-- supabase_realtime, así que los UPDATE se propagan sin DDL extra.
-- ─────────────────────────────────────────────────────────────
alter table sessions add column if not exists filters jsonb;
alter table sessions add column if not exists filters_updated_by text;

-- ─────────────────────────────────────────────────────────────
-- Migración M3 refresh async (2026-06-24): tabla refresh_status para
-- el estado del refresh asíncrono, leída por el frontend vía Realtime.
-- ─────────────────────────────────────────────────────────────
create table if not exists refresh_status (
  id int primary key default 1,
  status text not null default 'idle',
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb,
  updated_at timestamptz not null default now(),
  constraint refresh_status_singleton check (id = 1)
);
insert into refresh_status (id, status) values (1, 'idle') on conflict (id) do nothing;
alter table refresh_status enable row level security;
drop policy if exists "anon lee refresh_status" on refresh_status;
create policy "anon lee refresh_status" on refresh_status for select to anon using (true);
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'refresh_status'
  ) then
    alter publication supabase_realtime add table refresh_status;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Migración M4 motor de novedad (2026-06-25): user_movie_state para
-- ordenar el mazo por novedad cruzando sesiones. Privada (DENY anon).
-- ─────────────────────────────────────────────────────────────
create table if not exists user_movie_state (
  user_id uuid not null references users(id),
  movie_id uuid not null references movies(id),
  pass_count int not null default 0,
  last_passed_at timestamptz,
  last_liked_at timestamptz,
  primary key (user_id, movie_id)
);
alter table user_movie_state enable row level security;
drop policy if exists "anon no lee user_movie_state" on user_movie_state;
create policy "anon no lee user_movie_state" on user_movie_state for select to anon using (false);

-- ─────────────────────────────────────────────────────────────
-- Migración M5 novedad watchlist (2026-06-25): first_seen_at en
-- watchlist_items para mostrar primero las pelis recién agregadas.
-- Las filas existentes backfillean a now() por el default.
-- ─────────────────────────────────────────────────────────────
alter table watchlist_items add column if not exists first_seen_at timestamptz not null default now();
