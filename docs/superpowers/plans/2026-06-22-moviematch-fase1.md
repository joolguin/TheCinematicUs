# MovieMatch Fase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el MVP (Fase 1) de MovieMatch: una webapp donde Jo y Vale importan títulos a mano, swipean cards estilo Tinder, y al coincidir en un like ven un match en vivo en ambas pantallas.

**Architecture:** Monorepo con `frontend/` (React + Vite + TS) y `backend/` (Express + TS). El backend es dueño de la TMDB API key y la service role key de Supabase: resuelve/cachea TMDB, registra swipes y detecta matches. El frontend habla con el backend por REST y se suscribe por Supabase Realtime **solo** a la tabla `matches`. RLS bloquea la lectura de `swipes`/`watchlist_items` desde la anon key, garantizando la privacidad de likes a nivel de DB.

**Tech Stack:** React 18, Vite, TypeScript, Tailwind CSS, framer-motion, Supabase JS; Node + Express, Vitest (tests), Supabase Postgres.

## Global Constraints

- El nombre de la app es provisorio. Debe leerse de `VITE_APP_NAME` y centralizarse en `frontend/src/config.ts` (`APP_NAME`). Ningún componente hardcodea "MovieMatch".
- Solo 2 usuarias fijas: Jo (avatar 🐭) y Vale (avatar 🦆). Seed fijo, sin registro.
- **Privacidad de likes (innegociable):** ningún código del frontend puede leer los swipes de la otra usuaria. La anon key no debe poder leer `swipes` ni `watchlist_items` (RLS). El frontend solo lee `matches` y `movies` vía Supabase; todo lo demás pasa por el backend.
- El match es por sesión (efímero): una sesión nueva no arrastra swipes de sesiones anteriores.
- TMDB API key solo en el backend (`TMDB_API_KEY`). Nunca en el frontend.
- Cache agresivo: una peli ya resuelta en `movies` no se vuelve a pedir a TMDB.
- Comentarios en español en partes no obvias (matching TMDB, detección de match, lógica de sesiones).
- Mobile-first, estética oscura por defecto.
- Commits frecuentes y atómicos (uno por tarea como mínimo).

---

### Task 1: Scaffold del monorepo

**Files:**
- Create: `package.json` (raíz)
- Create: `.gitignore` (agregar a lo existente)
- Create: `.env.example`
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `frontend/` (vía Vite)

**Interfaces:**
- Produces: script raíz `npm run dev` que levanta backend y frontend con `concurrently`. Workspaces `frontend` y `backend`.

- [ ] **Step 1: Crear el frontend con Vite**

```bash
npm create vite@latest frontend -- --template react-ts
```

- [ ] **Step 2: Crear el package.json raíz**

```json
{
  "name": "moviematch",
  "private": true,
  "workspaces": ["frontend", "backend"],
  "scripts": {
    "dev": "concurrently -n backend,frontend -c blue,magenta \"npm:dev:backend\" \"npm:dev:frontend\"",
    "dev:backend": "npm --workspace backend run dev",
    "dev:frontend": "npm --workspace frontend run dev"
  },
  "devDependencies": {
    "concurrently": "^9.1.0"
  }
}
```

- [ ] **Step 3: Crear backend/package.json**

```json
{
  "name": "backend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 4: Crear backend/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Crear .env.example**

```bash
# Backend
TMDB_API_KEY=tu_api_key_de_tmdb
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service_role_key_solo_backend
APP_PASSPHRASE=frase_secreta_compartida
PORT=3001

# Frontend (prefijo VITE_)
VITE_APP_NAME=MovieMatch
VITE_API_URL=http://localhost:3001
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=anon_key_publica
```

- [ ] **Step 6: Instalar y verificar**

Run: `npm install`
Expected: instala sin errores; existe `node_modules/`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo frontend + backend"
```

---

### Task 2: Schema SQL de Supabase + seed + RLS

**Files:**
- Create: `backend/db/schema.sql`

**Interfaces:**
- Produces: tablas `users`, `movies`, `sessions`, `watchlist_items`, `swipes`, `matches`. Seed de 2 usuarias. RLS que permite a `anon` leer solo `movies` y `matches`.

- [ ] **Step 1: Escribir el schema SQL completo**

```sql
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
```

- [ ] **Step 2: Aplicar el schema en Supabase**

Acción manual: pegar `schema.sql` en el SQL editor de Supabase y ejecutar.
Expected: las 6 tablas creadas, `select * from users` devuelve 2 filas (Jo 🐭, Vale 🦆).

- [ ] **Step 3: Commit**

```bash
git add backend/db/schema.sql
git commit -m "feat: schema SQL de Supabase con seed y RLS"
```

---

### Task 3: Config del backend + middleware de passphrase

**Files:**
- Create: `backend/src/config.ts`
- Create: `backend/src/middleware/auth.ts`
- Test: `backend/src/middleware/auth.test.ts`

**Interfaces:**
- Produces:
  - `config` con `{ tmdbApiKey, supabaseUrl, supabaseServiceKey, appPassphrase, port }`.
  - `requirePassphrase(req, res, next)` — middleware Express que exige header `x-passphrase` igual a `config.appPassphrase`; responde 401 si no.

- [ ] **Step 1: Escribir el test del middleware**

```typescript
// backend/src/middleware/auth.test.ts
import { describe, it, expect, vi } from 'vitest';
import { requirePassphrase } from './auth.js';

vi.mock('../config.js', () => ({ config: { appPassphrase: 'secreta' } }));

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('requirePassphrase', () => {
  it('deja pasar con la passphrase correcta', () => {
    const next = vi.fn();
    requirePassphrase({ headers: { 'x-passphrase': 'secreta' } } as any, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('responde 401 con passphrase incorrecta', () => {
    const next = vi.fn();
    const res = mockRes();
    requirePassphrase({ headers: { 'x-passphrase': 'mala' } } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npm --workspace backend test`
Expected: FAIL — `./auth.js` no existe.

- [ ] **Step 3: Escribir config.ts**

```typescript
// backend/src/config.ts
import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

export const config = {
  tmdbApiKey: required('TMDB_API_KEY'),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  appPassphrase: required('APP_PASSPHRASE'),
  port: Number(process.env.PORT ?? 3001),
};
```

- [ ] **Step 4: Escribir el middleware**

```typescript
// backend/src/middleware/auth.ts
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

// Gate simple por passphrase compartida: la URL es pública, esto mantiene el link privado.
export function requirePassphrase(req: Request, res: Response, next: NextFunction) {
  if (req.headers['x-passphrase'] === config.appPassphrase) return next();
  return res.status(401).json({ error: 'Passphrase inválida' });
}
```

- [ ] **Step 5: Correr el test (debe pasar)**

Run: `npm --workspace backend test`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/config.ts backend/src/middleware/auth.ts backend/src/middleware/auth.test.ts
git commit -m "feat: config del backend y middleware de passphrase"
```

---

### Task 4: Cliente de Supabase (service role)

**Files:**
- Create: `backend/src/db.ts`

**Interfaces:**
- Produces: `supabase` — cliente `@supabase/supabase-js` creado con la service role key (ignora RLS). Lo consumen las tareas 5–9.

- [ ] **Step 1: Escribir el cliente**

```typescript
// backend/src/db.ts
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

// Cliente con service role: el backend tiene acceso total e ignora RLS.
export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false },
});
```

- [ ] **Step 2: Verificar typecheck**

Run: `npm --workspace backend run build`
Expected: compila sin errores.

- [ ] **Step 3: Commit**

```bash
git add backend/src/db.ts
git commit -m "feat: cliente de Supabase con service role"
```

---

### Task 5: Cliente de TMDB con parsing de títulos

**Files:**
- Create: `backend/src/tmdb.ts`
- Test: `backend/src/tmdb.test.ts`

**Interfaces:**
- Consumes: `config.tmdbApiKey`.
- Produces:
  - `parseTitleLine(line: string): { title: string; year: number | null }` — parsea `"Título (2019)"`.
  - `searchAndEnrich(title: string, year: number | null): Promise<MovieData>` — busca en TMDB y arma los datos de la peli. Si no hay match, devuelve `{ enriched: false, title, year, ... }` con el resto en null.
  - Tipo `MovieData` con: `tmdbId, title, originalTitle, year, posterUrl, director, cast (string[]), runtime, genres (string[]), overview, tmdbRating, country, enriched`.

- [ ] **Step 1: Escribir tests del parser**

```typescript
// backend/src/tmdb.test.ts
import { describe, it, expect } from 'vitest';
import { parseTitleLine } from './tmdb.js';

describe('parseTitleLine', () => {
  it('separa título y año', () => {
    expect(parseTitleLine('Parasite (2019)')).toEqual({ title: 'Parasite', year: 2019 });
  });
  it('título sin año', () => {
    expect(parseTitleLine('Amelie')).toEqual({ title: 'Amelie', year: null });
  });
  it('recorta espacios', () => {
    expect(parseTitleLine('  Drive (2011)  ')).toEqual({ title: 'Drive', year: 2011 });
  });
  it('ignora líneas vacías devolviendo título vacío', () => {
    expect(parseTitleLine('   ')).toEqual({ title: '', year: null });
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npm --workspace backend test tmdb`
Expected: FAIL — `./tmdb.js` no existe.

- [ ] **Step 3: Implementar tmdb.ts**

```typescript
// backend/src/tmdb.ts
import { config } from './config.js';

export interface MovieData {
  tmdbId: number | null;
  title: string;
  originalTitle: string | null;
  year: number | null;
  posterUrl: string | null;
  director: string | null;
  cast: string[] | null;
  runtime: number | null;
  genres: string[] | null;
  overview: string | null;
  tmdbRating: number | null;
  country: string | null;
  enriched: boolean;
}

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w500';

// Parsea una línea "Título (Año)". El año es opcional.
export function parseTitleLine(line: string): { title: string; year: number | null } {
  const trimmed = line.trim();
  const m = trimmed.match(/^(.*?)\s*\((\d{4})\)\s*$/);
  if (m) return { title: m[1].trim(), year: Number(m[2]) };
  return { title: trimmed, year: null };
}

async function tmdbGet(path: string, params: Record<string, string>) {
  const url = new URL(BASE + path);
  url.searchParams.set('api_key', config.tmdbApiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

// Busca una peli y la enriquece. Si no hay match, devuelve datos mínimos con enriched=false.
export async function searchAndEnrich(title: string, year: number | null): Promise<MovieData> {
  const minimal: MovieData = {
    tmdbId: null, title, originalTitle: null, year, posterUrl: null,
    director: null, cast: null, runtime: null, genres: null,
    overview: null, tmdbRating: null, country: null, enriched: false,
  };
  try {
    const params: Record<string, string> = { query: title };
    if (year) params.year = String(year);
    const search = await tmdbGet('/search/movie', params);
    const hit = search.results?.[0];
    if (!hit) return minimal;

    // append_to_response=credits trae director y cast en una sola llamada
    const d = await tmdbGet(`/movie/${hit.id}`, { append_to_response: 'credits' });
    const director = d.credits?.crew?.find((c: any) => c.job === 'Director')?.name ?? null;
    const cast = (d.credits?.cast ?? []).slice(0, 5).map((c: any) => c.name);
    return {
      tmdbId: d.id,
      title: d.title,
      originalTitle: d.original_title ?? null,
      year: d.release_date ? Number(d.release_date.slice(0, 4)) : year,
      posterUrl: d.poster_path ? IMG + d.poster_path : null,
      director,
      cast: cast.length ? cast : null,
      runtime: d.runtime ?? null,
      genres: (d.genres ?? []).map((g: any) => g.name),
      overview: d.overview || null,
      tmdbRating: d.vote_average ?? null,
      country: d.production_countries?.[0]?.iso_3166_1 ?? null,
      enriched: true,
    };
  } catch {
    // Rate limit / caída: devolvemos datos mínimos, el import no se corta.
    return minimal;
  }
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `npm --workspace backend test tmdb`
Expected: PASS (4 tests del parser).

- [ ] **Step 5: Commit**

```bash
git add backend/src/tmdb.ts backend/src/tmdb.test.ts
git commit -m "feat: cliente de TMDB con parser de títulos y enriquecimiento"
```

---

### Task 6: Capa de películas con cache

**Files:**
- Create: `backend/src/movies.ts`
- Test: `backend/src/movies.test.ts`

**Interfaces:**
- Consumes: `supabase` (db.ts), `searchAndEnrich`, `MovieData` (tmdb.ts).
- Produces: `resolveMovie(title, year): Promise<{ id: string }>` — busca en cache por `search_key`; si no está, llama a TMDB, inserta en `movies` y devuelve el id. Idempotente.
  - `search_key` se forma con `normalizeKey(title, year)` exportada: `` `${title.toLowerCase().trim()}|${year ?? ''}` ``.

- [ ] **Step 1: Escribir test de normalizeKey**

```typescript
// backend/src/movies.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeKey } from './movies.js';

describe('normalizeKey', () => {
  it('genera clave estable título+año', () => {
    expect(normalizeKey('Parasite', 2019)).toBe('parasite|2019');
  });
  it('clave sin año', () => {
    expect(normalizeKey('Amelie', null)).toBe('amelie|');
  });
  it('normaliza mayúsculas y espacios', () => {
    expect(normalizeKey('  DRIVE ', 2011)).toBe('drive|2011');
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npm --workspace backend test movies`
Expected: FAIL — `./movies.js` no existe.

- [ ] **Step 3: Implementar movies.ts**

```typescript
// backend/src/movies.ts
import { supabase } from './db.js';
import { searchAndEnrich } from './tmdb.js';

// Clave de cache estable para no re-pedir la misma peli a TMDB.
export function normalizeKey(title: string, year: number | null): string {
  return `${title.toLowerCase().trim()}|${year ?? ''}`;
}

export async function resolveMovie(title: string, year: number | null): Promise<{ id: string }> {
  const key = normalizeKey(title, year);

  // 1. ¿Ya está cacheada?
  const { data: existing } = await supabase
    .from('movies').select('id').eq('search_key', key).maybeSingle();
  if (existing) return { id: existing.id };

  // 2. Resolver contra TMDB (datos mínimos si no hay match)
  const m = await searchAndEnrich(title, year);

  // 3. Insertar en cache. Si otra request la insertó en paralelo, recuperarla.
  const { data: inserted, error } = await supabase.from('movies').insert({
    tmdb_id: m.tmdbId, title: m.title, original_title: m.originalTitle, year: m.year,
    poster_url: m.posterUrl, director: m.director, cast: m.cast, runtime: m.runtime,
    genres: m.genres, overview: m.overview, tmdb_rating: m.tmdbRating, country: m.country,
    enriched: m.enriched, search_key: key,
  }).select('id').single();

  if (error) {
    const { data: race } = await supabase
      .from('movies').select('id').eq('search_key', key).single();
    return { id: race!.id };
  }
  return { id: inserted!.id };
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `npm --workspace backend test movies`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/movies.ts backend/src/movies.test.ts
git commit -m "feat: resolución de películas con cache por search_key"
```

---

### Task 7: Capa de sesiones

**Files:**
- Create: `backend/src/sessions.ts`

**Interfaces:**
- Consumes: `supabase`.
- Produces:
  - `getActiveSession(): Promise<{ id: string }>` — devuelve la sesión activa; si no hay, crea una con `mode='pool'`.
  - `createSession(): Promise<{ id: string }>` — desactiva las anteriores (`active=false`) y crea una nueva activa. (Reset del mazo: el match es efímero.)

- [ ] **Step 1: Implementar sessions.ts**

```typescript
// backend/src/sessions.ts
import { supabase } from './db.js';

export async function getActiveSession(): Promise<{ id: string }> {
  const { data } = await supabase
    .from('sessions').select('id').eq('active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (data) return { id: data.id };
  return createSession();
}

// Una sesión nueva = noche nueva. Desactiva las viejas para que el mazo arranque de cero.
export async function createSession(): Promise<{ id: string }> {
  await supabase.from('sessions').update({ active: false }).eq('active', true);
  const { data, error } = await supabase
    .from('sessions').insert({ mode: 'pool', active: true }).select('id').single();
  if (error) throw error;
  return { id: data.id };
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npm --workspace backend run build`
Expected: compila sin errores.

- [ ] **Step 3: Commit**

```bash
git add backend/src/sessions.ts
git commit -m "feat: capa de sesiones (activa + reset)"
```

---

### Task 8: Detección de match

**Files:**
- Create: `backend/src/match.ts`
- Test: `backend/src/match.test.ts`

**Interfaces:**
- Consumes: `supabase`.
- Produces: `recordSwipeAndDetectMatch(sessionId, userId, movieId, liked): Promise<{ matched: boolean }>` — hace upsert del swipe; si `liked` y existe otro swipe `liked` de la **otra** usuaria en la misma sesión y peli, inserta en `matches` (idempotente por unique) y devuelve `{ matched: true }`.

- [ ] **Step 1: Escribir test de la lógica de match (con supabase mockeado)**

```typescript
// backend/src/match.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsert = vi.fn();
const insert = vi.fn();
const select = vi.fn();

vi.mock('./db.js', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'swipes' && select.mock) {
        return {
          upsert: (...a: any[]) => { upsert(...a); return Promise.resolve({ error: null }); },
          select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ neq: () => select() }) }) }) }),
        };
      }
      return { insert: (...a: any[]) => { insert(...a); return Promise.resolve({ error: null }); } };
    },
  },
}));

import { recordSwipeAndDetectMatch } from './match.js';

beforeEach(() => { upsert.mockClear(); insert.mockClear(); select.mockReset(); });

describe('recordSwipeAndDetectMatch', () => {
  it('NO matchea si la otra no likeó', async () => {
    select.mockResolvedValue({ data: [] });
    const r = await recordSwipeAndDetectMatch('s', 'u1', 'm', true);
    expect(r.matched).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it('matchea si la otra ya likeó', async () => {
    select.mockResolvedValue({ data: [{ id: 'x' }] });
    const r = await recordSwipeAndDetectMatch('s', 'u1', 'm', true);
    expect(r.matched).toBe(true);
    expect(insert).toHaveBeenCalled();
  });

  it('un pass nunca matchea', async () => {
    const r = await recordSwipeAndDetectMatch('s', 'u1', 'm', false);
    expect(r.matched).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `npm --workspace backend test match`
Expected: FAIL — `./match.js` no existe.

- [ ] **Step 3: Implementar match.ts**

```typescript
// backend/src/match.ts
import { supabase } from './db.js';

// Registra el swipe y detecta match. La lectura cruzada (swipes de la otra usuaria)
// la hace SOLO el backend con service role: el frontend nunca ve los likes ajenos.
export async function recordSwipeAndDetectMatch(
  sessionId: string, userId: string, movieId: string, liked: boolean,
): Promise<{ matched: boolean }> {
  await supabase.from('swipes').upsert(
    { session_id: sessionId, user_id: userId, movie_id: movieId, liked },
    { onConflict: 'session_id,user_id,movie_id' },
  );

  if (!liked) return { matched: false };

  // ¿La OTRA usuaria ya likeó esta peli en esta sesión?
  const { data: others } = await supabase
    .from('swipes').select('id')
    .eq('session_id', sessionId).eq('movie_id', movieId).eq('liked', true)
    .neq('user_id', userId);

  if (!others || others.length === 0) return { matched: false };

  // Insert idempotente: unique(session_id, movie_id) evita duplicados.
  await supabase.from('matches').insert({ session_id: sessionId, movie_id: movieId });
  return { matched: true };
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `npm --workspace backend test match`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/match.ts backend/src/match.test.ts
git commit -m "feat: detección de match en el backend"
```

---

### Task 9: Servidor Express con todos los endpoints

**Files:**
- Create: `backend/src/users.ts`
- Create: `backend/src/index.ts`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: servidor Express en `config.port` con:
  - `POST /import` `{ user, titles: string }` → resuelve líneas, crea `watchlist_items`, devuelve `{ imported, minimal }`.
  - `GET /deck?user=` → mazo pendiente (unión de watchlists - swipes propios).
  - `POST /swipe` `{ user, movieId, liked }` → `{ matched }`.
  - `GET /matches` → matches de la sesión activa con datos de la peli.
  - `POST /session` → crea sesión nueva.
  - `getUserByName(name): Promise<{ id }>` en users.ts.

- [ ] **Step 1: Implementar users.ts**

```typescript
// backend/src/users.ts
import { supabase } from './db.js';

export async function getUserByName(name: string): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('users').select('id').eq('name', name).single();
  if (error || !data) throw new Error(`Usuaria desconocida: ${name}`);
  return { id: data.id };
}
```

- [ ] **Step 2: Implementar index.ts**

```typescript
// backend/src/index.ts
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { requirePassphrase } from './middleware/auth.js';
import { supabase } from './db.js';
import { parseTitleLine } from './tmdb.js';
import { resolveMovie } from './movies.js';
import { getActiveSession, createSession } from './sessions.js';
import { recordSwipeAndDetectMatch } from './match.js';
import { getUserByName } from './users.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(requirePassphrase);

// Verifica la passphrase sin efectos (para el gate del frontend).
app.get('/auth/check', (_req, res) => res.json({ ok: true }));

// Importa títulos pegados a mano por una usuaria.
app.post('/import', async (req, res) => {
  try {
    const { user, titles } = req.body as { user: string; titles: string };
    const { id: userId } = await getUserByName(user);
    const { id: sessionId } = await getActiveSession();
    const lines = titles.split('\n').map(parseTitleLine).filter((l) => l.title);

    let imported = 0;
    let minimal = 0;
    for (const { title, year } of lines) {
      const { id: movieId } = await resolveMovie(title, year);
      const { data: movie } = await supabase
        .from('movies').select('enriched').eq('id', movieId).single();
      if (!movie?.enriched) minimal++;
      await supabase.from('watchlist_items').upsert(
        { session_id: sessionId, user_id: userId, movie_id: movieId },
        { onConflict: 'session_id,user_id,movie_id' },
      );
      imported++;
    }
    res.json({ imported, minimal });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Mazo pendiente: unión de watchlists de la sesión menos lo que esta usuaria ya swipeó.
app.get('/deck', async (req, res) => {
  try {
    const { id: userId } = await getUserByName(String(req.query.user));
    const { id: sessionId } = await getActiveSession();

    const { data: items } = await supabase
      .from('watchlist_items').select('movie_id').eq('session_id', sessionId);
    const movieIds = [...new Set((items ?? []).map((i) => i.movie_id))];

    const { data: swiped } = await supabase
      .from('swipes').select('movie_id').eq('session_id', sessionId).eq('user_id', userId);
    const swipedIds = new Set((swiped ?? []).map((s) => s.movie_id));

    const pending = movieIds.filter((id) => !swipedIds.has(id));
    const { data: movies } = await supabase.from('movies').select('*').in('id', pending);
    res.json({ deck: movies ?? [] });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Registra swipe y reporta si hubo match.
app.post('/swipe', async (req, res) => {
  try {
    const { user, movieId, liked } = req.body as { user: string; movieId: string; liked: boolean };
    const { id: userId } = await getUserByName(user);
    const { id: sessionId } = await getActiveSession();
    const result = await recordSwipeAndDetectMatch(sessionId, userId, movieId, liked);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Matches de la sesión activa, con datos de la peli para la lista.
app.get('/matches', async (_req, res) => {
  try {
    const { id: sessionId } = await getActiveSession();
    const { data } = await supabase
      .from('matches').select('movie_id, movies(*)').eq('session_id', sessionId)
      .order('created_at', { ascending: false });
    res.json({ matches: (data ?? []).map((m: any) => m.movies) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Nueva sesión = nueva noche, mazo reseteado.
app.post('/session', async (_req, res) => {
  try {
    const s = await createSession();
    res.json(s);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(config.port, () => console.log(`backend en :${config.port}`));
```

- [ ] **Step 3: Verificar typecheck y arranque**

Run: `npm --workspace backend run build`
Expected: compila sin errores. (Arranque real requiere `.env` con credenciales; verificación funcional en Task 16.)

- [ ] **Step 4: Commit**

```bash
git add backend/src/users.ts backend/src/index.ts
git commit -m "feat: servidor Express con import, deck, swipe, matches y session"
```

---

### Task 10: Config y cliente del frontend

**Files:**
- Create: `frontend/src/config.ts`
- Create: `frontend/src/api.ts`
- Create: `frontend/src/supabase.ts`
- Modify: `frontend/tailwind.config.js`, `frontend/src/index.css`

**Interfaces:**
- Produces:
  - `config.ts`: `APP_NAME`, `API_URL`.
  - `api.ts`: `api.get/post` que inyectan el header `x-passphrase` (de localStorage) y la base URL.
  - `supabase.ts`: cliente con anon key, exporta `supabase`.
  - Tipo `Movie` compartido con los campos de la tabla `movies`.

- [ ] **Step 1: Instalar dependencias del frontend**

```bash
npm --workspace frontend install @supabase/supabase-js framer-motion
npm --workspace frontend install -D tailwindcss postcss autoprefixer
npx --workspace frontend tailwindcss init -p
```

- [ ] **Step 2: Configurar Tailwind (modo oscuro por defecto)**

```javascript
// frontend/tailwind.config.js
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

```css
/* frontend/src/index.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

:root { color-scheme: dark; }
body { @apply bg-neutral-950 text-neutral-100; margin: 0; }
```

- [ ] **Step 3: Escribir config.ts**

```typescript
// frontend/src/config.ts
export const APP_NAME = import.meta.env.VITE_APP_NAME ?? 'MovieMatch';
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
```

- [ ] **Step 4: Escribir api.ts**

```typescript
// frontend/src/api.ts
import { API_URL } from './config';

export interface Movie {
  id: string;
  tmdb_id: number | null;
  title: string;
  original_title: string | null;
  year: number | null;
  poster_url: string | null;
  director: string | null;
  cast: string[] | null;
  runtime: number | null;
  genres: string[] | null;
  overview: string | null;
  tmdb_rating: number | null;
  country: string | null;
  enriched: boolean;
}

function headers() {
  return {
    'Content-Type': 'application/json',
    'x-passphrase': localStorage.getItem('passphrase') ?? '',
  };
}

export const api = {
  async get(path: string) {
    const res = await fetch(API_URL + path, { headers: headers() });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  },
  async post(path: string, body: unknown) {
    const res = await fetch(API_URL + path, {
      method: 'POST', headers: headers(), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  },
};
```

- [ ] **Step 5: Escribir supabase.ts**

```typescript
// frontend/src/supabase.ts
import { createClient } from '@supabase/supabase-js';

// Anon key: por RLS solo puede leer movies y matches. Nunca ve swipes ajenos.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/config.ts frontend/src/api.ts frontend/src/supabase.ts frontend/tailwind.config.js frontend/src/index.css frontend/postcss.config.js
git commit -m "feat: config, cliente API y Supabase del frontend con Tailwind oscuro"
```

---

### Task 11: App shell con routing por estado

**Files:**
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/types.ts`

**Interfaces:**
- Consumes: `APP_NAME`, pantallas (tareas 12–16).
- Produces: máquina de estados de pantallas: `gate → user → import → swipe`, con overlay de match y vista de matches superpuestas. Estado compartido: `user: 'Jo' | 'Vale'`.
  - `types.ts`: `export type UserName = 'Jo' | 'Vale';`

- [ ] **Step 1: Crear types.ts**

```typescript
// frontend/src/types.ts
export type UserName = 'Jo' | 'Vale';
export const AVATARS: Record<UserName, string> = { Jo: '🐭', Vale: '🦆' };
```

- [ ] **Step 2: Escribir App.tsx con la máquina de estados**

```tsx
// frontend/src/App.tsx
import { useState } from 'react';
import './index.css';
import { Gate } from './screens/Gate';
import { UserSelect } from './screens/UserSelect';
import { Import } from './screens/Import';
import { Swipe } from './screens/Swipe';
import type { UserName } from './types';

type Screen = 'gate' | 'user' | 'import' | 'swipe';

export default function App() {
  const [screen, setScreen] = useState<Screen>(
    localStorage.getItem('passphrase') ? 'user' : 'gate',
  );
  const [user, setUser] = useState<UserName | null>(null);

  if (screen === 'gate') return <Gate onOk={() => setScreen('user')} />;
  if (screen === 'user') return <UserSelect onPick={(u) => { setUser(u); setScreen('import'); }} />;
  if (screen === 'import' && user) return <Import user={user} onDone={() => setScreen('swipe')} />;
  if (screen === 'swipe' && user) return <Swipe user={user} />;
  return null;
}
```

- [ ] **Step 3: Verificar typecheck (fallará por imports faltantes — esperado hasta Task 15)**

Run: `npm --workspace frontend run build`
Expected: FAIL por pantallas inexistentes. Se resuelve al completar tareas 12–15. (No commitear aún.)

- [ ] **Step 4: Commit (tras crear las pantallas en 12–15; placeholder aquí)**

Nota: este commit se hace junto con Task 15 cuando el build pasa. Ver Task 15, Step final.

---

### Task 12: Pantalla Gate (passphrase)

**Files:**
- Create: `frontend/src/screens/Gate.tsx`

**Interfaces:**
- Consumes: `api`, `APP_NAME`.
- Produces: `<Gate onOk={() => void} />` — input de passphrase; al enviar la guarda en localStorage, llama `GET /auth/check`; si 200 → `onOk()`, si falla → muestra error y borra la passphrase.

- [ ] **Step 1: Escribir Gate.tsx**

```tsx
// frontend/src/screens/Gate.tsx
import { useState } from 'react';
import { api } from '../api';
import { APP_NAME } from '../config';

export function Gate({ onOk }: { onOk: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  async function submit() {
    localStorage.setItem('passphrase', value);
    try {
      await api.get('/auth/check');
      onOk();
    } catch {
      localStorage.removeItem('passphrase');
      setError(true);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-3xl font-semibold">{APP_NAME}</h1>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Frase secreta"
        className="w-full max-w-xs rounded-lg bg-neutral-900 px-4 py-3 outline-none"
      />
      <button onClick={submit} className="rounded-lg bg-rose-600 px-6 py-3 font-medium">
        Entrar
      </button>
      {error && <p className="text-rose-400">Frase incorrecta</p>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/screens/Gate.tsx
git commit -m "feat: pantalla de gate con passphrase"
```

---

### Task 13: Pantalla de selección de usuaria

**Files:**
- Create: `frontend/src/screens/UserSelect.tsx`

**Interfaces:**
- Consumes: `UserName`, `AVATARS`.
- Produces: `<UserSelect onPick={(u: UserName) => void} />` — dos botones grandes "Jo 🐭" y "Vale 🦆".

- [ ] **Step 1: Escribir UserSelect.tsx**

```tsx
// frontend/src/screens/UserSelect.tsx
import { AVATARS, type UserName } from '../types';

export function UserSelect({ onPick }: { onPick: (u: UserName) => void }) {
  const users: UserName[] = ['Jo', 'Vale'];
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
      <h2 className="text-xl text-neutral-400">¿Quién sos?</h2>
      <div className="flex gap-4">
        {users.map((u) => (
          <button
            key={u}
            onClick={() => onPick(u)}
            className="flex flex-col items-center gap-2 rounded-2xl bg-neutral-900 px-8 py-6 text-lg"
          >
            <span className="text-5xl">{AVATARS[u]}</span>
            {u}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/screens/UserSelect.tsx
git commit -m "feat: pantalla de selección de usuaria"
```

---

### Task 14: Pantalla de import

**Files:**
- Create: `frontend/src/screens/Import.tsx`

**Interfaces:**
- Consumes: `api`, `UserName`.
- Produces: `<Import user={UserName} onDone={() => void} />` — textarea, botón "Importar" que llama `POST /import`, muestra resultado (`imported`, `minimal`), botón "Empezar a swipear" → `onDone()`.

- [ ] **Step 1: Escribir Import.tsx**

```tsx
// frontend/src/screens/Import.tsx
import { useState } from 'react';
import { api } from '../api';
import type { UserName } from '../types';

export function Import({ user, onDone }: { user: UserName; onDone: () => void }) {
  const [titles, setTitles] = useState('');
  const [result, setResult] = useState<{ imported: number; minimal: number } | null>(null);
  const [loading, setLoading] = useState(false);

  async function importTitles() {
    setLoading(true);
    try {
      setResult(await api.post('/import', { user, titles }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col gap-4 p-6 max-w-md mx-auto">
      <h2 className="text-xl">Pegá tu watchlist, una por línea</h2>
      <p className="text-sm text-neutral-500">Formato: <code>Título (Año)</code></p>
      <textarea
        value={titles}
        onChange={(e) => setTitles(e.target.value)}
        rows={10}
        placeholder={'Parasite (2019)\nDrive (2011)\nAmelie (2001)'}
        className="rounded-lg bg-neutral-900 p-3 font-mono text-sm outline-none"
      />
      <button
        onClick={importTitles}
        disabled={loading || !titles.trim()}
        className="rounded-lg bg-rose-600 px-6 py-3 font-medium disabled:opacity-40"
      >
        {loading ? 'Importando…' : 'Importar'}
      </button>
      {result && (
        <div className="text-sm text-neutral-400">
          <p>Importadas: {result.imported} ({result.minimal} sin datos de TMDB)</p>
          <button onClick={onDone} className="mt-3 rounded-lg bg-emerald-600 px-6 py-3 font-medium text-neutral-100">
            Empezar a swipear
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/screens/Import.tsx
git commit -m "feat: pantalla de import manual de títulos"
```

---

### Task 15: Pantalla de swipe + card

**Files:**
- Create: `frontend/src/screens/Swipe.tsx`
- Create: `frontend/src/components/MovieCard.tsx`

**Interfaces:**
- Consumes: `api`, `Movie`, `UserName`, framer-motion.
- Produces: `<Swipe user={UserName} />` — carga `GET /deck`, muestra la card top con drag horizontal; like/pass por gesto o botones 👍👎 llaman `POST /swipe`; mantiene un contador de matches (de la respuesta `matched`); cuando se vacía el mazo muestra "esperando a la otra". `<MovieCard movie expanded onToggle />`.

- [ ] **Step 1: Escribir MovieCard.tsx**

```tsx
// frontend/src/components/MovieCard.tsx
import type { Movie } from '../api';

function runtimeLabel(min: number | null): string {
  if (!min) return '';
  return `${Math.floor(min / 60)}h ${min % 60}min`;
}

export function MovieCard({ movie, expanded, onToggle }: {
  movie: Movie; expanded: boolean; onToggle: () => void;
}) {
  return (
    <div onClick={onToggle} className="w-full h-full rounded-2xl overflow-hidden bg-neutral-900 flex flex-col cursor-pointer select-none">
      <div className="h-[60%] bg-neutral-800 flex items-center justify-center">
        {movie.poster_url
          ? <img src={movie.poster_url} alt={movie.title} className="h-full w-full object-cover" draggable={false} />
          : <span className="text-neutral-600 text-sm px-4 text-center">Sin poster — {movie.title}</span>}
      </div>
      <div className="p-4 flex-1 overflow-y-auto">
        <h3 className="text-lg font-semibold">{movie.title} {movie.year && <span className="text-neutral-500">({movie.year})</span>}</h3>
        <div className="flex flex-wrap gap-2 items-center text-sm text-neutral-400 mt-1">
          {movie.runtime && <span>{runtimeLabel(movie.runtime)}</span>}
          {movie.tmdb_rating != null && <span>⭐ {movie.tmdb_rating.toFixed(1)}</span>}
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {(movie.genres ?? []).map((g) => (
            <span key={g} className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs">{g}</span>
          ))}
        </div>
        {expanded && (
          <div className="mt-3 text-sm text-neutral-300 space-y-2">
            {movie.director && <p><span className="text-neutral-500">Dirección:</span> {movie.director}</p>}
            {movie.cast && <p><span className="text-neutral-500">Reparto:</span> {movie.cast.join(', ')}</p>}
            {movie.overview && <p>{movie.overview}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Escribir Swipe.tsx**

```tsx
// frontend/src/screens/Swipe.tsx
import { useEffect, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { api, type Movie } from '../api';
import type { UserName } from '../types';
import { MovieCard } from '../components/MovieCard';
import { MatchOverlay } from '../components/MatchOverlay';
import { MatchesList } from '../components/MatchesList';

export function Swipe({ user }: { user: UserName }) {
  const [deck, setDeck] = useState<Movie[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [showMatches, setShowMatches] = useState(false);
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  const opacity = useTransform(x, [-200, 0, 200], [0.5, 1, 0.5]);

  useEffect(() => { api.get(`/deck?user=${user}`).then((r) => setDeck(r.deck)); }, [user]);

  const top = deck[0];

  async function swipe(liked: boolean) {
    if (!top) return;
    const movie = top;
    setDeck((d) => d.slice(1));
    setExpanded(false);
    x.set(0);
    // No incrementamos acá: el contador lo maneja SOLO el Realtime (MatchOverlay.onCount),
    // así ambas pantallas cuentan igual y no se duplica para quien dispara el match.
    await api.post('/swipe', { user, movieId: movie.id, liked });
  }

  return (
    <div className="min-h-screen flex flex-col p-4 max-w-md mx-auto">
      <header className="flex justify-between items-center py-2">
        <span className="text-neutral-500">{user}</span>
        <button onClick={() => setShowMatches(true)} className="text-lg">❤️ {matchCount}</button>
      </header>

      <div className="flex-1 relative">
        {top ? (
          <motion.div
            key={top.id}
            style={{ x, rotate, opacity }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={(_, info) => {
              if (info.offset.x > 120) swipe(true);
              else if (info.offset.x < -120) swipe(false);
            }}
            className="absolute inset-0"
          >
            <MovieCard movie={top} expanded={expanded} onToggle={() => setExpanded((e) => !e)} />
          </motion.div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-center text-neutral-500">
            Terminaste tu mazo. La otra sigue eligiendo… 🍿
          </div>
        )}
      </div>

      {top && (
        <div className="flex justify-center gap-8 py-4">
          <button onClick={() => swipe(false)} className="h-16 w-16 rounded-full bg-neutral-800 text-2xl">👎</button>
          <button onClick={() => swipe(true)} className="h-16 w-16 rounded-full bg-rose-600 text-2xl">👍</button>
        </div>
      )}

      <MatchOverlay onCount={() => setMatchCount((c) => c + 1)} />
      {showMatches && <MatchesList onClose={() => setShowMatches(false)} />}
    </div>
  );
}
```

- [ ] **Step 3: Verificar build (aún faltan MatchOverlay/MatchesList — Task 16)**

Run: `npm --workspace frontend run build`
Expected: FAIL por `MatchOverlay`/`MatchesList`. Se resuelve en Task 16.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screens/Swipe.tsx frontend/src/components/MovieCard.tsx
git commit -m "feat: pantalla de swipe con card y gestos"
```

---

### Task 16: Match en vivo + lista de matches + verificación end-to-end

**Files:**
- Create: `frontend/src/components/MatchOverlay.tsx`
- Create: `frontend/src/components/MatchesList.tsx`
- Create: `README.md` (reemplaza el placeholder)

**Interfaces:**
- Consumes: `supabase` (Realtime), `api`, `Movie`, framer-motion.
- Produces:
  - `<MatchOverlay onCount={() => void} />` — se suscribe a inserts de `matches` por Supabase Realtime; al llegar uno, busca la peli y muestra overlay con poster + 🐭🦆; botones "Ver esta" / "Seguir buscando".
  - `<MatchesList onClose />` — `GET /matches`, lista de pósters + títulos.

- [ ] **Step 1: Escribir MatchOverlay.tsx**

```tsx
// frontend/src/components/MatchOverlay.tsx
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../supabase';
import { api, type Movie } from '../api';

export function MatchOverlay({ onCount }: { onCount: () => void }) {
  const [movie, setMovie] = useState<Movie | null>(null);

  useEffect(() => {
    // Suscripción Realtime: el match aparece en AMBAS pantallas al instante.
    const channel = supabase
      .channel('matches')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches' },
        async (payload) => {
          const movieId = (payload.new as any).movie_id;
          const { matches } = await api.get('/matches');
          const m = (matches as Movie[]).find((x) => x.id === movieId);
          if (m) { setMovie(m); onCount(); }
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [onCount]);

  return (
    <AnimatePresence>
      {movie && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center gap-4 p-6"
        >
          <div className="text-4xl">🐭 ¡Match! 🦆</div>
          {movie.poster_url && <img src={movie.poster_url} className="max-h-[50vh] rounded-xl" />}
          <h3 className="text-2xl font-semibold text-center">{movie.title}</h3>
          <div className="flex gap-4">
            <button onClick={() => setMovie(null)} className="rounded-lg bg-neutral-800 px-5 py-3">Seguir buscando</button>
            <button onClick={() => setMovie(null)} className="rounded-lg bg-rose-600 px-5 py-3 font-medium">Ver esta</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Escribir MatchesList.tsx**

```tsx
// frontend/src/components/MatchesList.tsx
import { useEffect, useState } from 'react';
import { api, type Movie } from '../api';

export function MatchesList({ onClose }: { onClose: () => void }) {
  const [matches, setMatches] = useState<Movie[]>([]);
  useEffect(() => { api.get('/matches').then((r) => setMatches(r.matches)); }, []);

  return (
    <div className="fixed inset-0 z-40 bg-neutral-950 p-4 overflow-y-auto">
      <div className="flex justify-between items-center mb-4 max-w-md mx-auto">
        <h2 className="text-xl">Matches de esta noche</h2>
        <button onClick={onClose} className="text-neutral-400">Cerrar</button>
      </div>
      <div className="grid grid-cols-2 gap-3 max-w-md mx-auto">
        {matches.length === 0 && <p className="text-neutral-500 col-span-2">Todavía no hay matches.</p>}
        {matches.map((m) => (
          <div key={m.id} className="rounded-xl overflow-hidden bg-neutral-900">
            {m.poster_url && <img src={m.poster_url} className="w-full" />}
            <p className="p-2 text-sm">{m.title}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Escribir README.md**

```markdown
# MovieMatch (Fase 1)

App de matching de películas estilo Tinder para dos personas (Jo 🐭 y Vale 🦆).

## Correr local

1. `npm install`
2. Crear `.env` en la raíz copiando `.env.example` y completar las credenciales.
3. Crear el proyecto en Supabase y ejecutar `backend/db/schema.sql` en el SQL editor.
4. `npm run dev` (levanta backend en :3001 y frontend en :5173).

## Variables de entorno

Ver `.env.example`. La `SUPABASE_SERVICE_ROLE_KEY` y `TMDB_API_KEY` van solo en el backend.

## Deploy

- **DB:** Supabase (ejecutar `backend/db/schema.sql`).
- **Backend:** Railway o Render. Setear `TMDB_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_PASSPHRASE`, `PORT`.
- **Frontend:** Vercel. Setear `VITE_APP_NAME`, `VITE_API_URL` (URL del backend), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Cambiar el nombre de la app

Editar `VITE_APP_NAME` en el `.env` del frontend. Todo el resto lo lee de `frontend/src/config.ts`.
```

- [ ] **Step 4: Build completo del frontend (ya pasa)**

Run: `npm --workspace frontend run build`
Expected: PASS — compila sin errores.

- [ ] **Step 5: Verificación end-to-end manual**

Con `.env` completo y schema aplicado:
1. `npm run dev`.
2. Abrir `http://localhost:5173` en dos pestañas (o dos dispositivos).
3. Pestaña A: entrar con passphrase → "Jo" → importar 3 títulos → swipear.
4. Pestaña B: "Vale" → importar 3 títulos (al menos 1 igual que Jo) → likear esa peli.
5. Esperado: cuando ambas likean la misma, aparece el overlay de match en **ambas** pestañas; el contador ❤️ sube; la lista de matches la muestra.

Expected: match en vivo visible en las dos pestañas.

- [ ] **Step 6: Commit final**

```bash
git add frontend/src/components/MatchOverlay.tsx frontend/src/components/MatchesList.tsx frontend/src/App.tsx frontend/src/types.ts README.md
git commit -m "feat: match en vivo, lista de matches y README; cierra Fase 1"
```

---

## Notas de cierre

- Tras Task 16 el build del frontend pasa (App.tsx ya tiene todas las pantallas) y el backend compila + sus tests verdes (`npm --workspace backend test`).
- La verificación funcional real (match en vivo) requiere `.env` con credenciales de Supabase y TMDB — no se puede automatizar sin ellas; está descrita como paso manual en Task 16.
- Fuera de alcance (Fase 2/3): scraping de Letterboxd, import por CSV, modo intersección, historial con ratings y "ya la vimos", puntaje de Letterboxd.
