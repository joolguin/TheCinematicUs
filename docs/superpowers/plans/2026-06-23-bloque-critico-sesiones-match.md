# Bloque crítico (sesiones y match) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los tres hoyos críticos de la Fase 1 — sesión global silenciosa, carrera al crear sesión, y match simultáneo perdido — sin aflojar la privacidad de likes.

**Architecture:** A nivel DB, un índice único parcial garantiza una sola sesión activa. En el backend, una función de reconciliación crea los matches mutuos que la carrera dejó sin fila, y corre como backstop en cada swipe-like y al leer `/matches`. En el frontend, una suscripción Realtime a `sessions` reacomoda la pantalla (soft reset + aviso) cuando la otra inicia una noche nueva; los matches vistos se guardan por sesión.

**Tech Stack:** Node + Express + TS (backend), Vitest (tests backend), Supabase Postgres + Realtime, React + Vite + TS + framer-motion (frontend), Docker Compose (todo el entorno).

## Global Constraints

- **Todo corre en Docker.** Nunca ejecutar npm/node en el host. Tests backend: `docker compose run --rm backend npm --workspace backend test`. Build frontend: `docker compose run --rm frontend npm --workspace frontend run build`.
- **Commits sin trailer `Co-Authored-By: Claude`.**
- **Copy de UI en español neutro chileno** (tú, no voseo).
- **Secrets sólo en backend.** `SUPABASE_SERVICE_ROLE_KEY` y `TMDB_API_KEY` nunca en el frontend.
- **Privacidad de likes:** el frontend nunca lee `swipes` ni `watchlist_items`. Toda lectura cruzada vive en el backend con service role.
- **`recordSwipeAndDetectMatch` no se modifica** (sus tests quedan verdes). La reconciliación es una función nueva e independiente.

---

### Task 1: Migración de base de datos

**Files:**
- Modify: `backend/db/schema.sql` (agregar columna, índice y publicación + bloque de migración idempotente al final)

**Interfaces:**
- Produces: columna `sessions.started_by text`, índice `one_active_session`, tabla `sessions` publicada en `supabase_realtime`. Las tareas siguientes asumen que existen en la DB viva.

- [ ] **Step 1: Agregar la columna `started_by` a la definición de `sessions`**

En `backend/db/schema.sql`, reemplazar el bloque `create table sessions (...)` por:

```sql
create table sessions (
  id uuid primary key default gen_random_uuid(),
  mode text not null default 'pool',
  active boolean not null default true,
  started_by text,
  created_at timestamptz not null default now()
);
```

- [ ] **Step 2: Agregar el bloque de migración idempotente al final del archivo**

Al final de `backend/db/schema.sql`, después de la línea `alter publication supabase_realtime add table matches;`, agregar:

```sql

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
```

- [ ] **Step 3: Aplicar la migración en Supabase**

Abrir el SQL editor del proyecto Supabase y ejecutar el bloque de migración (los 4 statements de arriba). Si `alter publication ... add table sessions` falla con "table already member", ignorar — es idempotente en la práctica.

- [ ] **Step 4: Verificar el resultado**

Ejecutar en el SQL editor:

```sql
select count(*) as activas from sessions where active;                 -- debe ser 0 o 1
select column_name from information_schema.columns
  where table_name = 'sessions' and column_name = 'started_by';        -- debe devolver 1 fila
select indexname from pg_indexes where indexname = 'one_active_session'; -- debe devolver 1 fila
```

Esperado: `activas` ≤ 1; las otras dos consultas devuelven una fila cada una.

- [ ] **Step 5: Commit**

```bash
git add backend/db/schema.sql
git commit -m "db: una sola sesión activa, started_by y sessions en Realtime"
```

---

### Task 2: Sesión única activa + `startedBy`

**Files:**
- Modify: `backend/src/sessions.ts`
- Test: `backend/src/sessions.test.ts` (crear)

**Interfaces:**
- Consumes: índice `one_active_session` (Task 1) que hace que el insert concurrente falle con código `23505`.
- Produces:
  - `getActiveSession(): Promise<{ id: string }>`
  - `createSession(startedBy?: string): Promise<{ id: string }>`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `backend/src/sessions.test.ts`:

```ts
// backend/src/sessions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let activeRow: any;       // lo que devuelve la lectura de la sesión activa
let insertResult: any;    // { data, error } que devuelve el insert
const updateMock = vi.fn();
const insertMock = vi.fn();

vi.mock('./db.js', () => ({
  supabase: {
    from: () => ({
      // select('id').eq('active', true).order().limit().maybeSingle()
      select: () => ({
        eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: activeRow }) }) }) }),
      }),
      // update({ active: false }).eq('active', true)
      update: (...a: any[]) => { updateMock(...a); return { eq: () => Promise.resolve({ error: null }) }; },
      // insert({...}).select('id').single()
      insert: (...a: any[]) => { insertMock(...a); return { select: () => ({ single: () => Promise.resolve(insertResult) }) }; },
    }),
  },
}));

import { getActiveSession, createSession } from './sessions.js';

beforeEach(() => {
  activeRow = null;
  insertResult = { data: { id: 'nueva' }, error: null };
  updateMock.mockClear();
  insertMock.mockClear();
});

describe('getActiveSession', () => {
  it('devuelve la sesión activa si existe', async () => {
    activeRow = { id: 's1' };
    expect(await getActiveSession()).toEqual({ id: 's1' });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('crea una sesión si no hay activa', async () => {
    activeRow = null;
    insertResult = { data: { id: 's2' }, error: null };
    expect(await getActiveSession()).toEqual({ id: 's2' });
    expect(insertMock).toHaveBeenCalled();
  });
});

describe('createSession', () => {
  it('desactiva las activas y devuelve la nueva', async () => {
    insertResult = { data: { id: 's3' }, error: null };
    expect(await createSession()).toEqual({ id: 's3' });
    expect(updateMock).toHaveBeenCalledWith({ active: false });
  });

  it('guarda started_by', async () => {
    insertResult = { data: { id: 's4' }, error: null };
    await createSession('Vale');
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ started_by: 'Vale' }));
  });

  it('ante carrera (23505) re-lee la sesión activa ganadora', async () => {
    insertResult = { data: null, error: { code: '23505', message: 'duplicate' } };
    activeRow = { id: 'ganadora' };
    expect(await createSession()).toEqual({ id: 'ganadora' });
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `docker compose run --rm backend npm --workspace backend test -- sessions.test`
Expected: FAIL (el test de `started_by` y el de carrera fallan: hoy `createSession` no acepta argumento ni maneja `23505`).

- [ ] **Step 3: Implementar `sessions.ts`**

Reemplazar el contenido completo de `backend/src/sessions.ts` por:

```ts
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
// El índice único parcial `one_active_session` garantiza una sola activa: si dos llamadas
// concurrentes insertan, una gana y la otra (error 23505) re-lee la ganadora.
export async function createSession(startedBy?: string): Promise<{ id: string }> {
  await supabase.from('sessions').update({ active: false }).eq('active', true);
  const { data, error } = await supabase
    .from('sessions')
    .insert({ mode: 'pool', active: true, started_by: startedBy ?? null })
    .select('id').single();
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      const { data: active } = await supabase
        .from('sessions').select('id').eq('active', true)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (active) return { id: active.id };
    }
    throw error;
  }
  return { id: data.id };
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `docker compose run --rm backend npm --workspace backend test -- sessions.test`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/sessions.ts backend/src/sessions.test.ts
git commit -m "feat(sesiones): sesión única activa atómica + started_by"
```

---

### Task 3: Reconciliación de matches

**Files:**
- Modify: `backend/src/match.ts` (agregar `reconcileMatches`, NO tocar `recordSwipeAndDetectMatch`)
- Test: `backend/src/reconcile.test.ts` (crear)

**Interfaces:**
- Produces: `reconcileMatches(sessionId: string): Promise<void>` — crea (idempotente) las filas de `matches` para toda peli de la sesión donde dos usuarias distintas dieron like y aún no hay match.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `backend/src/reconcile.test.ts`:

```ts
// backend/src/reconcile.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let likes: any[];                 // filas de swipes likeados de la sesión
const upsertMatch = vi.fn();

vi.mock('./db.js', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'swipes') {
        // select('movie_id, user_id').eq('session_id', x).eq('liked', true)
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: likes }) }) }) };
      }
      // tabla matches: upsert idempotente
      return { upsert: (...a: any[]) => { upsertMatch(...a); return Promise.resolve({ error: null }); } };
    },
  },
}));

import { reconcileMatches } from './match.js';

beforeEach(() => { likes = []; upsertMatch.mockClear(); });

describe('reconcileMatches', () => {
  it('crea match cuando dos usuarias likearon la misma peli', async () => {
    likes = [
      { movie_id: 'm1', user_id: 'jo' },
      { movie_id: 'm1', user_id: 'vale' },
    ];
    await reconcileMatches('s');
    expect(upsertMatch).toHaveBeenCalledTimes(1);
    expect(upsertMatch).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: 's', movie_id: 'm1' }),
      expect.anything(),
    );
  });

  it('no crea match si sólo una likeó', async () => {
    likes = [{ movie_id: 'm1', user_id: 'jo' }];
    await reconcileMatches('s');
    expect(upsertMatch).not.toHaveBeenCalled();
  });

  it('no cuenta dos likes de la MISMA usuaria como match', async () => {
    likes = [
      { movie_id: 'm1', user_id: 'jo' },
      { movie_id: 'm1', user_id: 'jo' },
    ];
    await reconcileMatches('s');
    expect(upsertMatch).not.toHaveBeenCalled();
  });

  it('sólo reconcilia las pelis con match entre varias', async () => {
    likes = [
      { movie_id: 'm1', user_id: 'jo' },
      { movie_id: 'm1', user_id: 'vale' },  // match
      { movie_id: 'm2', user_id: 'jo' },    // sólo una
    ];
    await reconcileMatches('s');
    expect(upsertMatch).toHaveBeenCalledTimes(1);
    expect(upsertMatch).toHaveBeenCalledWith(
      expect.objectContaining({ movie_id: 'm1' }),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `docker compose run --rm backend npm --workspace backend test -- reconcile.test`
Expected: FAIL con "reconcileMatches is not a function" / no exportada.

- [ ] **Step 3: Implementar `reconcileMatches` en `match.ts`**

En `backend/src/match.ts`, agregar al final del archivo (sin tocar lo existente):

```ts
// Backstop de carrera: crea las filas de match que la detección directa pudo perder
// si ambas likearon en el mismo instante. Idempotente vía unique(session_id, movie_id).
export async function reconcileMatches(sessionId: string): Promise<void> {
  const { data: likes } = await supabase
    .from('swipes').select('movie_id, user_id')
    .eq('session_id', sessionId).eq('liked', true);
  if (!likes) return;

  // Agrupar por peli contando usuarias DISTINTAS.
  const usersByMovie = new Map<string, Set<string>>();
  for (const { movie_id, user_id } of likes as { movie_id: string; user_id: string }[]) {
    const set = usersByMovie.get(movie_id) ?? new Set<string>();
    set.add(user_id);
    usersByMovie.set(movie_id, set);
  }

  const matched = [...usersByMovie.entries()]
    .filter(([, users]) => users.size >= 2)
    .map(([movieId]) => movieId);

  for (const movieId of matched) {
    await supabase.from('matches').upsert(
      { session_id: sessionId, movie_id: movieId },
      { onConflict: 'session_id,movie_id', ignoreDuplicates: true },
    );
  }
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `docker compose run --rm backend npm --workspace backend test -- reconcile.test`
Expected: PASS (4 tests).

- [ ] **Step 5: Correr toda la suite backend (no romper `match.test.ts`)**

Run: `docker compose run --rm backend npm --workspace backend test`
Expected: PASS (todos los archivos, incluido `match.test.ts` sin cambios).

- [ ] **Step 6: Commit**

```bash
git add backend/src/match.ts backend/src/reconcile.test.ts
git commit -m "feat(match): reconcileMatches como backstop de carrera"
```

---

### Task 4: Wiring de endpoints (`index.ts`)

**Files:**
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `createSession(startedBy?)` (Task 2), `reconcileMatches(sessionId)` (Task 3).
- Produces:
  - `POST /session` acepta `{ user }` en el body y lo guarda como `started_by`.
  - `GET /matches` reconcilia antes de leer y devuelve `{ sessionId, matches }`.
  - `POST /swipe` corre `reconcileMatches` como backstop cuando el swipe es un like.

- [ ] **Step 1: Importar `reconcileMatches`**

En `backend/src/index.ts`, cambiar la línea de import de `./match.js`:

```ts
import { recordSwipeAndDetectMatch, reconcileMatches } from './match.js';
```

- [ ] **Step 2: Backstop en `POST /swipe`**

Reemplazar el handler de `/swipe` por:

```ts
// Registra swipe y reporta si hubo match. Reconcilia como backstop de carrera.
app.post('/swipe', async (req, res) => {
  try {
    const { user, movieId, liked } = req.body as { user: string; movieId: string; liked: boolean };
    const { id: userId } = await getUserByName(user);
    const { id: sessionId } = await getActiveSession();
    const result = await recordSwipeAndDetectMatch(sessionId, userId, movieId, liked);
    if (liked) await reconcileMatches(sessionId);
    res.json(result);
  } catch (e: any) {
    console.error('[error endpoint]', e);
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3: `GET /matches` reconcilia y devuelve `sessionId`**

Reemplazar el handler de `/matches` por:

```ts
// Matches de la sesión activa, con datos de la peli. Reconcilia antes de leer (red de seguridad).
app.get('/matches', async (_req, res) => {
  try {
    const { id: sessionId } = await getActiveSession();
    await reconcileMatches(sessionId);
    const { data } = await supabase
      .from('matches').select('id, movies(*)').eq('session_id', sessionId)
      .order('created_at', { ascending: false });
    // sessionId: el frontend lo usa como baseline de la suscripción y para scopear los matches vistos.
    // matchId: identifica cada match; el resto son los campos de la película.
    res.json({ sessionId, matches: (data ?? []).map((m: any) => ({ matchId: m.id, ...m.movies })) });
  } catch (e: any) {
    console.error('[error endpoint]', e);
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 4: `POST /session` registra quién inició**

Reemplazar el handler de `/session` por:

```ts
// Nueva sesión = nueva noche, mazo reseteado. Guarda quién la inició para el aviso en vivo.
app.post('/session', async (req, res) => {
  try {
    const { user } = req.body as { user?: string };
    const s = await createSession(user);
    res.json(s);
  } catch (e: any) {
    console.error('[error endpoint]', e);
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 5: Verificar que compila**

Run: `docker compose run --rm backend npm --workspace backend run build`
Expected: termina sin errores de TypeScript (genera `dist/`).

- [ ] **Step 6: Verificación manual de endpoints**

Levantar el backend (`docker compose up backend`) y, con la passphrase real en lugar de `LA_FRASE`:

```bash
curl -s -X POST localhost:3001/session \
  -H 'content-type: application/json' -H 'x-passphrase: LA_FRASE' \
  -d '{"user":"Vale"}'
# Esperado: {"id":"<uuid>"}

curl -s localhost:3001/matches -H 'x-passphrase: LA_FRASE'
# Esperado: {"sessionId":"<uuid>","matches":[...]}
```

Esperado: `/session` devuelve un `id`; `/matches` devuelve `sessionId` + `matches`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(api): /session con started_by, /matches con sessionId y reconcile, backstop en /swipe"
```

---

### Task 5: Frontend — sesión en vivo + matches vistos por sesión

**Files:**
- Modify: `frontend/src/components/MatchOverlay.tsx`
- Modify: `frontend/src/screens/Swipe.tsx`

**Interfaces:**
- Consumes: respuesta de `/matches` con forma `{ sessionId, matches }` (Task 4); `POST /session` con `{ user }` (Task 4).
- Produces: `MatchOverlay` ahora recibe prop `sessionId: string | null`. `Swipe` es dueño del `sessionId` y se suscribe a `sessions`.

> Ambos archivos cambian juntos porque `Swipe` pasa `sessionId` a `MatchOverlay`: separarlos rompería el build de TypeScript. El frontend no tiene suite de tests (patrón Fase 1); la verificación es build en Docker + prueba manual con dos navegadores.

- [ ] **Step 1: Reescribir `MatchOverlay.tsx` (seen por sesión + prop sessionId)**

Reemplazar el contenido completo de `frontend/src/components/MatchOverlay.tsx` por:

```tsx
// frontend/src/components/MatchOverlay.tsx
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../supabase';
import { api, type Movie } from '../api';

// Un match en cola para mostrar: el id del match + los datos de la peli.
type Queued = { matchId: string; movie: Movie };

// Matches ya mostrados en ESTE dispositivo, scopeados por sesión (no se arrastran entre noches).
function seenKey(sessionId: string) { return `seenMatches:${sessionId}`; }
function getSeen(sessionId: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(seenKey(sessionId)) ?? '[]')); }
  catch { return new Set(); }
}
function markSeen(sessionId: string, matchId: string) {
  const s = getSeen(sessionId);
  s.add(matchId);
  localStorage.setItem(seenKey(sessionId), JSON.stringify([...s]));
}

// /matches devuelve { sessionId, matches: [{ matchId, ...camposDePeli }] }
async function fetchMatches(): Promise<{ sessionId: string; items: Queued[] }> {
  const { sessionId, matches } = await api.get('/matches');
  const items = (matches as (Movie & { matchId: string })[]).map((m) => ({ matchId: m.matchId, movie: m }));
  return { sessionId, items };
}

export function MatchOverlay({ sessionId, onCount, onChoose }: { sessionId: string | null; onCount: () => void; onChoose: (m: Movie) => void }) {
  const [queue, setQueue] = useState<Queued[]>([]);

  function enqueue(items: Queued[]) {
    setQueue((q) => {
      const known = new Set(q.map((x) => x.matchId));
      const nuevos = items.filter((x) => !known.has(x.matchId));
      return nuevos.length ? [...q, ...nuevos] : q;
    });
  }

  // Al entrar o al cambiar de sesión (noche nueva): limpiar la cola y encolar los no vistos.
  useEffect(() => {
    if (!sessionId) return;
    setQueue([]);
    let active = true;
    fetchMatches().then(({ items }) => {
      if (!active) return;
      const seen = getSeen(sessionId);
      enqueue(items.filter((q) => !seen.has(q.matchId)));
    });
    return () => { active = false; };
  }, [sessionId]);

  // En vivo: un match nuevo de ESTA sesión aparece al instante en ambas pantallas.
  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel('matches')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches' },
        async (payload) => {
          const row = payload.new as { id: string; session_id: string };
          if (row.session_id !== sessionId) return;     // match de otra sesión: ignorar
          if (getSeen(sessionId).has(row.id)) return;
          const { items } = await fetchMatches();
          const found = items.find((q) => q.matchId === row.id);
          if (found) { enqueue([found]); onCount(); }
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId, onCount]);

  const current = queue[0];

  function next() { setQueue((q) => q.slice(1)); }
  function seguir() { if (current && sessionId) markSeen(sessionId, current.matchId); next(); }
  function ver() { if (current && sessionId) { markSeen(sessionId, current.matchId); onChoose(current.movie); } next(); }

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.matchId}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center gap-4 p-6"
        >
          <div className="text-4xl">🐭 ¡Match! 🦆</div>
          {current.movie.poster_url && <img src={current.movie.poster_url} className="max-h-[50vh] rounded-xl" />}
          <h3 className="text-2xl font-semibold text-center">{current.movie.title}</h3>
          <div className="flex gap-4">
            <button onClick={seguir} className="rounded-lg bg-neutral-800 px-5 py-3">Seguir buscando</button>
            <button onClick={ver} className="rounded-lg bg-rose-600 px-5 py-3 font-medium">Ver esta</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Reescribir `Swipe.tsx` (sessionId, suscripción a sessions, soft reset, aviso)**

Reemplazar el contenido completo de `frontend/src/screens/Swipe.tsx` por:

```tsx
// frontend/src/screens/Swipe.tsx
import { useEffect, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { supabase } from '../supabase';
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
  const [chosen, setChosen] = useState<Movie | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  const opacity = useTransform(x, [-200, 0, 200], [0.5, 1, 0.5]);

  useEffect(() => { api.get(`/deck?user=${user}`).then((r) => setDeck(r.deck)); }, [user]);

  // Contador real + sessionId actual (baseline de la suscripción y scoping de matches vistos).
  useEffect(() => {
    api.get('/matches').then((r) => { setMatchCount(r.matches.length); setSessionId(r.sessionId); });
  }, []);

  // Reacomoda la pantalla a la sesión `id` sin recargar la página.
  function softReset(id: string) {
    setExpanded(false);
    setShowMatches(false);
    setChosen(null);
    setMatchCount(0);
    setSessionId(id);
    x.set(0);
    api.get(`/deck?user=${user}`).then((r) => setDeck(r.deck));
  }

  // En vivo: si la otra inicia una noche nueva, avisar y reacomodar.
  useEffect(() => {
    const channel = supabase
      .channel('sessions')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessions' },
        (payload) => {
          const nueva = payload.new as { id: string; started_by: string | null };
          if (nueva.id === sessionId) return;       // ya es la sesión actual
          if (nueva.started_by === user) return;    // la inicié yo: ya hice soft reset local
          const avatar = nueva.started_by === 'Vale' ? '🦆' : '🐭';
          setAviso(`${avatar} ${nueva.started_by ?? 'Alguien'} empezó una noche nueva`);
          softReset(nueva.id);
          setTimeout(() => setAviso(null), 4000);
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId, user]);

  // Empezar una noche nueva: crea la sesión (queda quién la inició) y reacomoda localmente.
  async function nuevaSesion() {
    const s = await api.post('/session', { user });
    softReset(s.id);
  }

  // Desde el header pedimos confirmación: reinicia la noche para las dos.
  async function confirmarNuevaSesion() {
    if (window.confirm('¿Empezar una sesión nueva? Se reinicia el mazo y los matches de esta noche para las dos.')) {
      await nuevaSesion();
    }
  }

  const top = deck[0];

  // Película elegida: pantalla final, en vez de caer en "terminaste tu mazo".
  if (chosen) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-5 p-6 text-center">
        <div className="text-3xl">🎬 ¡Esta noche ven!</div>
        {chosen.poster_url && <img src={chosen.poster_url} className="max-h-[55vh] rounded-xl" />}
        <h2 className="text-2xl font-semibold">{chosen.title} {chosen.year && <span className="text-neutral-500">({chosen.year})</span>}</h2>
        <div className="text-2xl">🐭 🍿 🦆</div>
        <div className="flex gap-4 mt-2">
          <button onClick={() => setChosen(null)} className="rounded-lg bg-neutral-800 px-5 py-3">Volver a elegir</button>
          <button onClick={nuevaSesion} className="rounded-lg bg-rose-600 px-5 py-3 font-medium">Nueva sesión</button>
        </div>
      </div>
    );
  }

  async function swipe(liked: boolean) {
    if (!top) return;
    const movie = top;
    setDeck((d) => d.slice(1));
    setExpanded(false);
    x.set(0);
    // No incrementamos acá: el contador lo maneja SOLO el Realtime (MatchOverlay.onCount).
    await api.post('/swipe', { user, movieId: movie.id, liked });
  }

  return (
    <div className="min-h-screen flex flex-col p-4 max-w-md mx-auto">
      {aviso && (
        <div className="fixed top-3 inset-x-0 z-40 mx-auto w-fit rounded-full bg-neutral-800 px-4 py-2 text-sm shadow-lg">
          {aviso}
        </div>
      )}
      <header className="flex justify-between items-center py-2">
        <span className="text-neutral-500">{user}</span>
        <div className="flex items-center gap-3">
          <button onClick={confirmarNuevaSesion} className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm">🔄 Nueva sesión</button>
          <button onClick={() => setShowMatches(true)} className="text-lg">❤️ {matchCount}</button>
        </div>
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

      <MatchOverlay sessionId={sessionId} onCount={() => setMatchCount((c) => c + 1)} onChoose={setChosen} />
      {showMatches && <MatchesList onClose={() => setShowMatches(false)} />}
    </div>
  );
}
```

- [ ] **Step 3: Verificar que el frontend compila**

Run: `docker compose run --rm frontend npm --workspace frontend run build`
Expected: build exitoso, sin errores de TypeScript (la prop `sessionId` de `MatchOverlay` queda satisfecha).

- [ ] **Step 4: Verificación manual con dos navegadores**

Levantar todo (`docker compose up`) y abrir la app en dos navegadores/perfiles, una como Jo y otra como Vale:
1. Las dos likean la misma peli casi a la vez → aparece el match en ambas (reconciliación + Realtime).
2. Una toca "🔄 Nueva sesión" y confirma → en la otra pantalla aparece el aviso "🦆/🐭 … empezó una noche nueva", el mazo se recarga y el contador vuelve a 0, sin recargar la página.
3. Tras la noche nueva, los matches de la noche anterior no reaparecen como nuevos (seen por sesión).

Esperado: los tres comportamientos ocurren. (Verificación manual; no hay test automatizado de frontend.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MatchOverlay.tsx frontend/src/screens/Swipe.tsx
git commit -m "feat(frontend): sesión en vivo con aviso + soft reset y matches vistos por sesión"
```

---

## Notas de cierre

- **`MatchesList.tsx` no cambia:** sigue consumiendo `/matches`; el campo extra `sessionId` se ignora sin romper.
- **Deploy:** tras mergear, el backend (Render) y el frontend (Vercel) se redeployan. La migración SQL (Task 1) ya quedó aplicada en Supabase en su Step 3 — no requiere acción extra en deploy.
- **Fuera de alcance (otro día):** `seenMatches` cross-dispositivo, presencia/online, persistir la usuaria al refrescar. Documentados en la crítica, no en este plan.
