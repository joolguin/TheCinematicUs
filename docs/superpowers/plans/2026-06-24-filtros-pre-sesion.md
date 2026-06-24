# Filtros pre-sesión (compartidos) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acotar el mazo de la noche por duración máxima y géneros excluidos, con un filtro único compartido por sesión y sincronizado en vivo entre las dos usuarias.

**Architecture:** El filtro es estado de la sesión (`sessions.filters` jsonb), fuente de verdad en la DB. El **backend** aplica el filtro en `GET /deck` (la lógica vive donde hay tests). El frontend edita el filtro vía `POST /session/filters` (debounced), refetchea `/deck`, y se sincroniza con la otra usuaria por Realtime sobre la fila de `sessions`, mostrando un aviso efímero.

**Tech Stack:** Node 24 (alpine), TypeScript ESM, Express, `@supabase/supabase-js`, vitest (backend). React 19 + Vite + framer-motion + Supabase Realtime (frontend, sin runner de tests).

## Global Constraints

- **Todo corre en Docker. Nunca `npm`/`node` en el host.** Desde la raíz `/Users/jo/Documents/TheCinematicUs`:
  - backend suite: `docker compose run --rm --workdir /app/backend backend npm test`
  - backend 1 file: `docker compose run --rm --workdir /app/backend backend npx vitest run src/<archivo>.test.ts`
  - frontend typecheck: `docker compose run --rm --workdir /app/frontend frontend npx tsc -b`
- **ESM:** imports internos con extensión `.js` (backend). 
- **Migraciones idempotentes:** DDL al final de `backend/db/schema.sql` con `if not exists`, reflejado además en el `create table` de cabecera. Se aplica a mano en Supabase (el implementador solo edita el archivo; NO se conecta a Supabase).
- **Commits sin trailer `Co-Authored-By: Claude`.** Mensajes en español, estilo del repo.
- **Forma del filtro (verbatim):** `SessionFilters = { maxRuntime: number | null; excludeGenres: string[] }`. `null` en la columna = sin filtro. `{ maxRuntime: null, excludeGenres: [] }` = sin efecto.
- **HTTP:** el endpoint de filtros se implementa como `POST /session/filters` (no PATCH), para no ampliar el helper `api` del frontend (solo tiene `get`/`post`).
- **Frontend sin tests:** las tareas de frontend se validan con `tsc -b` + prueba manual. Toda la lógica con riesgo (filtrado, géneros) vive en el backend y SÍ se testea.

---

### Task 1: Módulo de filtrado puro (`filters.ts`)

Funciones puras `applyFilters` y `collectGenres`, sin dependencias de Supabase. Es el núcleo testeable.

**Files:**
- Create: `backend/src/filters.ts`
- Test: `backend/src/filters.test.ts`

**Interfaces:**
- Produces:
  - `interface SessionFilters { maxRuntime: number | null; excludeGenres: string[] }`
  - `applyFilters<T extends { runtime: number | null; genres: string[] | null }>(movies: T[], filters: SessionFilters | null): T[]`
  - `collectGenres(movies: { genres: string[] | null }[]): string[]`

- [ ] **Step 1: Escribir los tests que fallan**

Create `backend/src/filters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyFilters, collectGenres, type SessionFilters } from './filters.js';

const M = (over: Partial<{ id: string; runtime: number | null; genres: string[] | null }>) => ({
  id: 'x', runtime: null, genres: null, ...over,
});

describe('applyFilters', () => {
  const pool = [
    M({ id: 'corta', runtime: 80, genres: ['Comedy'] }),
    M({ id: 'larga', runtime: 180, genres: ['Drama'] }),
    M({ id: 'terror', runtime: 95, genres: ['Horror', 'Thriller'] }),
    M({ id: 'sinRuntime', runtime: null, genres: ['Drama'] }),
    M({ id: 'sinGenres', runtime: 100, genres: null }),
  ];

  it('sin filtro (null) es passthrough', () => {
    expect(applyFilters(pool, null)).toEqual(pool);
  });

  it('maxRuntime mantiene cortas y las de runtime desconocido, saca largas', () => {
    const r = applyFilters(pool, { maxRuntime: 120, excludeGenres: [] }).map((m) => m.id);
    expect(r).toEqual(['corta', 'terror', 'sinRuntime', 'sinGenres']); // 'larga' (180) fuera
  });

  it('excludeGenres saca las que tienen un género excluido, mantiene genres null', () => {
    const r = applyFilters(pool, { maxRuntime: null, excludeGenres: ['Horror'] }).map((m) => m.id);
    expect(r).toEqual(['corta', 'larga', 'sinRuntime', 'sinGenres']); // 'terror' fuera
  });

  it('combina runtime y géneros', () => {
    const r = applyFilters(pool, { maxRuntime: 120, excludeGenres: ['Drama'] }).map((m) => m.id);
    // fuera: 'larga' (180 y Drama), 'sinRuntime' (Drama). queda corta, terror, sinGenres
    expect(r).toEqual(['corta', 'terror', 'sinGenres']);
  });

  it('maxRuntime null + excludeGenres vacío es passthrough', () => {
    expect(applyFilters(pool, { maxRuntime: null, excludeGenres: [] })).toEqual(pool);
  });

  it('tolera campos faltantes en filters (tratados como sin efecto)', () => {
    expect(applyFilters(pool, {} as SessionFilters)).toEqual(pool);
  });
});

describe('collectGenres', () => {
  it('devuelve unión ordenada y deduplicada, ignora genres null', () => {
    const r = collectGenres([
      { genres: ['Drama', 'Comedy'] },
      { genres: ['Comedy', 'Horror'] },
      { genres: null },
    ]);
    expect(r).toEqual(['Comedy', 'Drama', 'Horror']);
  });

  it('pool vacío → []', () => {
    expect(collectGenres([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `docker compose run --rm --workdir /app/backend backend npx vitest run src/filters.test.ts`
Expected: FAIL — `Cannot find module './filters.js'`.

- [ ] **Step 3: Implementar `filters.ts`**

Create `backend/src/filters.ts`:

```ts
// backend/src/filters.ts
// Lógica pura de filtrado del mazo. Sin dependencias de Supabase: recibe arrays,
// devuelve arrays. Es el único lugar con riesgo de bug (nulls, exclusión), por eso
// vive en el backend (donde hay tests) y no en el frontend.

export interface SessionFilters {
  maxRuntime: number | null; // minutos; null = sin límite
  excludeGenres: string[];   // géneros a excluir; [] = sin exclusión
}

interface Filterable {
  runtime: number | null;
  genres: string[] | null;
}

export function applyFilters<T extends Filterable>(movies: T[], filters: SessionFilters | null): T[] {
  if (!filters) return movies;
  const maxRuntime = filters.maxRuntime ?? null;
  const exclude = new Set(filters.excludeGenres ?? []);
  return movies.filter((m) => {
    // Duración: desconocida (null) no se esconde.
    if (maxRuntime != null && m.runtime != null && m.runtime > maxRuntime) return false;
    // Géneros excluidos: genres null pasa (no se puede excluir lo que no se conoce).
    if (exclude.size > 0 && m.genres && m.genres.some((g) => exclude.has(g))) return false;
    return true;
  });
}

export function collectGenres(movies: { genres: string[] | null }[]): string[] {
  const set = new Set<string>();
  for (const m of movies) for (const g of m.genres ?? []) set.add(g);
  return [...set].sort();
}
```

- [ ] **Step 4: Correr y verificar verde**

Run: `docker compose run --rm --workdir /app/backend backend npx vitest run src/filters.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/filters.ts backend/src/filters.test.ts
git commit -m "feat(backend): módulo puro de filtrado del mazo (applyFilters, collectGenres)"
```

---

### Task 2: Columnas `filters` en `sessions` + `getActiveSession` las devuelve

DDL de las columnas nuevas y que `getActiveSession` seleccione/devuelva `filters`.

**Files:**
- Modify: `backend/db/schema.sql` (`create table sessions` + migración)
- Modify: `backend/src/sessions.ts:4-10` (`getActiveSession`)
- Test: `backend/src/sessions.test.ts` (actualizar expectativas)

**Interfaces:**
- Consumes: `SessionFilters` de `./filters.js` (Task 1).
- Produces: `getActiveSession(): Promise<{ id: string; filters: SessionFilters | null }>`.

- [ ] **Step 1: DDL — columnas nuevas**

En `backend/db/schema.sql`, en `create table sessions` agregar dos columnas:

```sql
create table sessions (
  id uuid primary key default gen_random_uuid(),
  mode text not null default 'pool',
  active boolean not null default true,
  started_by text,
  filters jsonb,
  filters_updated_by text,
  created_at timestamptz not null default now()
);
```

Al final del archivo:

```sql
-- ─────────────────────────────────────────────────────────────
-- Migración M2 filtros (2026-06-24): filtro compartido por sesión.
-- filters (jsonb, null = sin filtro) + filters_updated_by (quién lo
-- tocó, para el aviso en vivo). sessions ya está en la publicación
-- supabase_realtime, así que los UPDATE se propagan sin DDL extra.
-- ─────────────────────────────────────────────────────────────
alter table sessions add column if not exists filters jsonb;
alter table sessions add column if not exists filters_updated_by text;
```

- [ ] **Step 2: Actualizar los tests de `getActiveSession` (RED)**

En `backend/src/sessions.test.ts`, cambiar las dos expectativas de `getActiveSession` para incluir `filters`:

```ts
  it('devuelve la sesión activa si existe', async () => {
    activeRow = { id: 's1', filters: null };
    expect(await getActiveSession()).toEqual({ id: 's1', filters: null });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('crea una sesión si no hay activa', async () => {
    activeRow = null;
    insertResult = { data: { id: 's2' }, error: null };
    expect(await getActiveSession()).toEqual({ id: 's2', filters: null });
    expect(insertMock).toHaveBeenCalled();
  });
```

- [ ] **Step 3: Correr y ver fallar**

Run: `docker compose run --rm --workdir /app/backend backend npx vitest run src/sessions.test.ts`
Expected: FAIL — `getActiveSession` hoy devuelve `{ id }` sin `filters`.

- [ ] **Step 4: Implementar el cambio en `getActiveSession`**

En `backend/src/sessions.ts`, agregar el import y modificar `getActiveSession`:

```ts
import { supabase } from './db.js';
import type { SessionFilters } from './filters.js';

export async function getActiveSession(): Promise<{ id: string; filters: SessionFilters | null }> {
  const { data } = await supabase
    .from('sessions').select('id, filters').eq('active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (data) return { id: data.id, filters: (data.filters as SessionFilters | null) ?? null };
  const created = await createSession();
  return { id: created.id, filters: null };
}
```

(`createSession` no cambia: una sesión nueva nace con `filters` en default `null`.)

- [ ] **Step 5: Correr y verificar verde**

Run: `docker compose run --rm --workdir /app/backend backend npx vitest run src/sessions.test.ts`
Expected: PASS (los 6 tests de sessions). Las llamadas a `getActiveSession` en `index.ts` que destructuran `{ id: sessionId }` siguen funcionando (ignoran el campo extra).

- [ ] **Step 6: Correr el suite completo**

Run: `docker compose run --rm --workdir /app/backend backend npm test`
Expected: PASS (todo el backend).

- [ ] **Step 7: Commit**

```bash
git add backend/db/schema.sql backend/src/sessions.ts backend/src/sessions.test.ts
git commit -m "feat(backend): sessions.filters + filters_updated_by; getActiveSession devuelve filters"
```

---

### Task 3: Endpoints — `/deck` filtrado + `POST /session/filters`

`/deck` aplica los filtros de la sesión y devuelve `genres`+`filters`; nuevo endpoint para escribir el filtro. Los endpoints de `index.ts` no tienen tests unitarios hoy; se validan con `tsc` + prueba manual.

**Files:**
- Modify: `backend/src/index.ts` (`/deck` handler + nuevo `POST /session/filters`)

**Interfaces:**
- Consumes: `applyFilters`, `collectGenres`, `SessionFilters` de `./filters.js`; `getActiveSession(): { id, filters }` de `./sessions.js`.
- Produces (HTTP):
  - `GET /deck?user=X` → `{ deck: Movie[], genres: string[], filters: SessionFilters | null }`
  - `POST /session/filters` body `{ user: string, filters: SessionFilters }` → `{ ok: true }`

- [ ] **Step 1: Importar el módulo de filtros**

En `backend/src/index.ts`, agregar a los imports:

```ts
import { applyFilters, collectGenres, type SessionFilters } from './filters.js';
```

- [ ] **Step 2: Modificar el handler `/deck`**

Reemplazar el cuerpo del handler `app.get('/deck', ...)` por:

```ts
app.get('/deck', async (req, res) => {
  try {
    const { id: userId } = await getUserByName(String(req.query.user));
    const { id: sessionId, filters } = await getActiveSession();

    const { data: items } = await supabase
      .from('watchlist_items').select('movie_id');
    const movieIds = [...new Set((items ?? []).map((i) => i.movie_id))];

    const { data: swiped } = await supabase
      .from('swipes').select('movie_id').eq('session_id', sessionId).eq('user_id', userId);
    const swipedIds = new Set((swiped ?? []).map((s) => s.movie_id));

    const pending = movieIds.filter((id) => !swipedIds.has(id));
    const { data: movies } = await supabase.from('movies').select('*').in('id', pending);
    const pool = movies ?? [];
    // genres se calcula del pool pendiente SIN filtrar, para poblar los chips
    // aunque el filtro activo excluya algunos.
    res.json({ deck: applyFilters(pool, filters), genres: collectGenres(pool), filters });
  } catch (e: any) {
    console.error('[error endpoint]', e);
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3: Agregar el endpoint `POST /session/filters`**

Justo después del handler `/deck`, agregar:

```ts
// Escribe el filtro de la noche en la sesión activa. Compartido: cualquiera lo
// edita; el Realtime de sessions propaga el cambio a la otra usuaria.
app.post('/session/filters', async (req, res) => {
  try {
    const { user, filters } = req.body as { user: string; filters: SessionFilters };
    const { id: sessionId } = await getActiveSession();
    const { error } = await supabase
      .from('sessions')
      .update({ filters, filters_updated_by: user })
      .eq('id', sessionId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[error endpoint]', e);
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 4: Typecheck del backend (build)**

Run: `docker compose run --rm --workdir /app/backend backend npm run build`
Expected: `tsc` sin errores.

- [ ] **Step 5: Correr el suite (regresión)**

Run: `docker compose run --rm --workdir /app/backend backend npm test`
Expected: PASS — ningún test existente se rompe (los endpoints no estaban testeados; `getActiveSession`/`filters.ts` sí).

- [ ] **Step 6: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(backend): /deck aplica filtros de la sesión + POST /session/filters"
```

---

### Task 4: Frontend — tipos + hook de Realtime para cambios de filtro

`SessionFilters` en el frontend y extensión de `useSessionListener` para reaccionar a UPDATE de la sesión (sync del filtro + aviso). Sin runner de tests → se valida con `tsc -b`.

**Files:**
- Modify: `frontend/src/api.ts` (tipo `SessionFilters` + tipo de respuesta de `/deck`)
- Modify: `frontend/src/hooks/useSessionListener.ts`

**Interfaces:**
- Produces:
  - `interface SessionFilters { maxRuntime: number | null; excludeGenres: string[] }` (en `api.ts`)
  - `useSessionListener(user, sessionId, onNewSession, onFiltersChanged?)` donde
    `onFiltersChanged?: (filters: SessionFilters | null, by: string) => void`.

- [ ] **Step 1: Agregar `SessionFilters` a `api.ts`**

En `frontend/src/api.ts`, después de la interface `Movie`, agregar:

```ts
export interface SessionFilters {
  maxRuntime: number | null;
  excludeGenres: string[];
}

export interface DeckResponse {
  deck: Movie[];
  genres: string[];
  filters: SessionFilters | null;
}
```

- [ ] **Step 2: Extender `useSessionListener` con el handler UPDATE**

Reemplazar `frontend/src/hooks/useSessionListener.ts` por:

```ts
import { useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import type { UserName } from '../types';
import type { SessionFilters } from '../api';

export function useSessionListener(
  user: UserName,
  sessionId: string | null,
  onNewSession: (id: string) => void,
  onFiltersChanged?: (filters: SessionFilters | null, by: string) => void,
) {
  const sessionIdRef = useRef(sessionId);
  const onNewSessionRef = useRef(onNewSession);
  const onFiltersChangedRef = useRef(onFiltersChanged);

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { onNewSessionRef.current = onNewSession; }, [onNewSession]);
  useEffect(() => { onFiltersChangedRef.current = onFiltersChanged; }, [onFiltersChanged]);

  useEffect(() => {
    const channel = supabase
      .channel('sessions')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessions' },
        (payload) => {
          const nueva = payload.new as { id: string; started_by: string | null };
          if (nueva.id === sessionIdRef.current) return;
          if (nueva.started_by === user) return;
          onNewSessionRef.current(nueva.id);
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions' },
        (payload) => {
          const row = payload.new as {
            id: string; filters: SessionFilters | null; filters_updated_by: string | null;
          };
          // Solo el UPDATE de la sesión actual, y solo si lo cambió la OTRA usuaria.
          if (row.id !== sessionIdRef.current) return;
          if (!row.filters_updated_by || row.filters_updated_by === user) return;
          onFiltersChangedRef.current?.(row.filters, row.filters_updated_by);
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);
}
```

(Se agregan refs para `onNewSession`/`onFiltersChanged` y se sacan de las deps del `useEffect` de la suscripción, para no re-suscribir el canal en cada render cuando esas callbacks cambian de identidad. El comportamiento INSERT se mantiene.)

- [ ] **Step 3: Typecheck del frontend**

Run: `docker compose run --rm --workdir /app/frontend frontend npx tsc -b`
Expected: sin errores. (El 4º parámetro es opcional, así que el llamado actual en `Swipe.tsx` con 3 args sigue compilando hasta la Task 5.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.ts frontend/src/hooks/useSessionListener.ts
git commit -m "feat(frontend): SessionFilters + useSessionListener escucha UPDATE de filtros"
```

---

### Task 5: Frontend — control de filtros en la pantalla de swipe

Componente `FilterBar` + cableado en `Swipe.tsx`: leer `genres`/`filters` de `/deck`, editar con debounce + refetch, sincronizar por Realtime con aviso.

**Files:**
- Create: `frontend/src/components/FilterBar.tsx`
- Modify: `frontend/src/screens/Swipe.tsx`

**Interfaces:**
- Consumes: `SessionFilters`, `DeckResponse` de `../api`; `useSessionListener(..., onFiltersChanged)` de `../hooks`.
- Produces: componente `FilterBar` con props `{ genres: string[]; filters: SessionFilters | null; onChange: (f: SessionFilters) => void }`.

- [ ] **Step 1: Crear `FilterBar.tsx`**

Create `frontend/src/components/FilterBar.tsx`:

```tsx
import { useState } from 'react';
import type { SessionFilters } from '../api';

const EMPTY: SessionFilters = { maxRuntime: null, excludeGenres: [] };

export function FilterBar({
  genres, filters, onChange,
}: { genres: string[]; filters: SessionFilters | null; onChange: (f: SessionFilters) => void }) {
  const [open, setOpen] = useState(false);
  const current = filters ?? EMPTY;
  const active = current.maxRuntime != null || current.excludeGenres.length > 0;

  function setMaxRuntime(v: number | null) {
    onChange({ ...current, maxRuntime: v });
  }
  function toggleGenre(g: string) {
    const has = current.excludeGenres.includes(g);
    onChange({
      ...current,
      excludeGenres: has ? current.excludeGenres.filter((x) => x !== g) : [...current.excludeGenres, g],
    });
  }

  return (
    <div className="mb-2 text-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`rounded-lg px-3 py-1.5 ${active ? 'bg-rose-600' : 'bg-neutral-800'}`}
      >
        ☰ Filtros{active ? ' •' : ''}
      </button>
      {open && (
        <div className="mt-2 rounded-lg bg-neutral-900 p-3 flex flex-col gap-3">
          <label className="flex items-center gap-2">
            <span className="w-24 text-neutral-400">Duración máx</span>
            <input
              type="range" min={60} max={240} step={15}
              value={current.maxRuntime ?? 240}
              onChange={(e) => setMaxRuntime(Number(e.target.value))}
              className="flex-1"
            />
            <span className="w-20 text-right">
              {current.maxRuntime == null ? 'sin límite' : `${current.maxRuntime} min`}
            </span>
            {current.maxRuntime != null && (
              <button onClick={() => setMaxRuntime(null)} className="text-neutral-400 underline">
                quitar
              </button>
            )}
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-neutral-400">Excluir géneros</span>
            <div className="flex flex-wrap gap-1.5">
              {genres.map((g) => {
                const excluded = current.excludeGenres.includes(g);
                return (
                  <button
                    key={g}
                    onClick={() => toggleGenre(g)}
                    className={`rounded-full px-2.5 py-1 ${excluded ? 'bg-rose-600 line-through' : 'bg-neutral-800'}`}
                  >
                    {g}
                  </button>
                );
              })}
              {genres.length === 0 && <span className="text-neutral-600">sin géneros en el mazo</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Cablear `Swipe.tsx` — estado, carga y FilterBar**

En `frontend/src/screens/Swipe.tsx`:

(a) Imports — agregar `useRef` y los tipos/el componente:

```ts
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
```
```ts
import { api, type Movie, type SessionFilters, type DeckResponse } from '../api';
import { FilterBar } from '../components/FilterBar';
```

(b) Estado nuevo (junto a los demás `useState`):

```ts
  const [filters, setFilters] = useState<SessionFilters | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const postTimer = useRef<number | undefined>(undefined);
```

(c) Helper de refetch del deck (reemplaza el patrón repetido `api.get('/deck'...)`). Agregar antes del primer `useEffect`:

```ts
  const loadDeck = useCallback(async () => {
    const r: DeckResponse = await api.get(`/deck?user=${user}`);
    setDeck(r.deck); setGenres(r.genres); setFilters(r.filters); setDeckLoaded(true);
  }, [user]);
```

(d) Reemplazar el `useEffect` de carga inicial del deck (líneas con `api.get(`/deck?user=${user}`)...`) por:

```ts
  useEffect(() => { loadDeck(); }, [loadDeck]);
```

(e) En `softReset(id)`, reemplazar la línea `api.get(`/deck?user=${user}`).then(...)` por `loadDeck();` (el filtro se re-lee solo; una sesión nueva viene con `filters` null).

(f) Editar filtro localmente con debounce + refetch:

```ts
  function applyLocalFilter(next: SessionFilters) {
    setFilters(next); // feedback inmediato del control
    window.clearTimeout(postTimer.current);
    postTimer.current = window.setTimeout(async () => {
      await api.post('/session/filters', { user, filters: next });
      await loadDeck();
    }, 400);
  }
```

(g) Recibir el cambio de la otra usuaria (sin re-postear):

```ts
  const onFiltersChanged = useCallback((f: SessionFilters | null, by: string) => {
    setFilters(f);
    loadDeck();
    setAviso(`${by} cambió el filtro`);
    setTimeout(() => setAviso(null), 4000);
  }, [loadDeck]);
```

(h) Pasar el 4º argumento al hook:

```ts
  useSessionListener(user, sessionId, (newSessionId) => {
    setAviso(`Empezó una noche nueva`);
    softReset(newSessionId);
    setTimeout(() => setAviso(null), 4000);
  }, onFiltersChanged);
```

(i) Renderizar el `FilterBar` arriba del mazo, justo después del `<PresenceBadge .../>`:

```tsx
      <FilterBar genres={genres} filters={filters} onChange={applyLocalFilter} />
```

- [ ] **Step 3: Typecheck del frontend**

Run: `docker compose run --rm --workdir /app/frontend frontend npx tsc -b`
Expected: sin errores.

- [ ] **Step 4: Build del frontend (sanity)**

Run: `docker compose run --rm --workdir /app/frontend frontend npm run build`
Expected: build OK (`tsc -b && vite build`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FilterBar.tsx frontend/src/screens/Swipe.tsx
git commit -m "feat(frontend): control de filtros en swipe (debounce + refetch + sync por Realtime)"
```

---

## Verificación manual (tras implementar, con la app levantada)

`docker compose up`, abrir dos navegadores (Jo y Vale) en la sesión activa:
1. Jo abre Filtros, baja la duración a 90 → el mazo de Jo se achica; Vale ve el aviso "Jo cambió el filtro" y su mazo se achica igual.
2. Vale excluye "Horror" → ambas dejan de ver pelis de terror; Jo ve "Vale cambió el filtro".
3. Quitar todos los filtros → el mazo vuelve completo en las dos.
4. "Nueva sesión" → arranca sin filtro.

## Fuera de alcance (anotado)
- Streaming / providers, `includeGenres`, contador de cards restantes, tests de frontend.
- Aplicar el DDL de Task 2 en Supabase (lo hace el humano en el SQL editor).
