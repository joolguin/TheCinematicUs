# Motor de novedad — `user_movie_state` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistir estado acumulado por usuaria cruzando sesiones y ordenar el mazo por novedad (nunca-vistas → pasadas hace más tiempo), para romper el loop de las mismas cards.

**Architecture:** Tabla `user_movie_state` (privada, DENY anon). Un módulo `userMovieState.ts` con la escritura por swipe (`recordMovieState`), la lectura (`getMovieStates`) y el orden puro (`orderByNovelty`). `/swipe` registra el estado; `/deck` ordena el deck filtrado. Sin cambios de frontend.

**Tech Stack:** Node 24 (alpine), TypeScript ESM, Express, `@supabase/supabase-js`, vitest. Soft cooldown (reordenar, nunca esconder).

## Global Constraints

- **Todo corre en Docker. Nunca `npm`/`node` en el host.** Desde la raíz `/Users/jo/Documents/TheCinematicUs`:
  - backend suite: `docker compose run --rm --workdir /app/backend backend npm test`
  - backend 1 file: `docker compose run --rm --workdir /app/backend backend npx vitest run src/<archivo>.test.ts`
  - backend build: `docker compose run --rm --workdir /app/backend backend npm run build`
- **ESM:** imports internos con extensión `.js`.
- **Migraciones idempotentes:** DDL al final de `backend/db/schema.sql` con guardas, reflejado en el `create table` de cabecera. Se aplica a mano en Supabase (el implementador solo edita el archivo; NO se conecta a Supabase).
- **Commits normales por tarea, mensaje en español, estilo repo. NO trailer `Co-Authored-By: Claude`.**
- **Privacidad:** `user_movie_state` es privada → RLS + policy `DENY` para anon (`using (false)`), fuera de la publicación Realtime.
- **Tipos (verbatim):** `MovieState = { pass_count: number; last_passed_at: string | null; last_liked_at: string | null }`.
- **Orden por novedad:** nunca-vistas (sin fila) primero; entre vistas, `last_passed_at` ascendente con null = época 0 (alta prioridad); desempate `pass_count` ascendente; empate total preserva orden de entrada.

---

### Task 1: Tabla `user_movie_state` (DDL + DENY anon) + test de privacidad

**Files:**
- Modify: `backend/db/schema.sql`
- Modify: `backend/src/privacy.integration.test.ts`

**Interfaces:**
- Produces (DB): tabla `user_movie_state(user_id, movie_id, pass_count, last_passed_at, last_liked_at)`, PK `(user_id, movie_id)`, RLS + DENY anon, NO en Realtime.

- [ ] **Step 1: Agregar el `create table` en la cabecera de `schema.sql`**

Después de `create table matches (...)` (y antes del seed de `users`), agregar:

```sql
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
```

- [ ] **Step 2: RLS + DENY anon en la sección de policies**

Junto a las otras policies DENY (`anon no lee swipes`, etc.), agregar:

```sql
alter table user_movie_state enable row level security;
create policy "anon no lee user_movie_state" on user_movie_state for select to anon using (false);
```

(NO se agrega a `supabase_realtime`: el frontend nunca la lee.)

- [ ] **Step 3: Bloque de migración idempotente al final del archivo**

```sql
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
```

- [ ] **Step 4: Extender el test de privacidad anon**

En `backend/src/privacy.integration.test.ts`, agregar un tercer caso dentro del `suite`:

```ts
  it('no lee user_movie_state', async () => {
    const { data } = await anon.from('user_movie_state').select('*').limit(1);
    expect(data ?? []).toHaveLength(0);
  });
```

- [ ] **Step 5: Correr el test de privacidad**

Run: `docker compose run --rm --workdir /app/backend backend npx vitest run src/privacy.integration.test.ts`
Expected: PASS (3 tests) si el `.env` tiene `SUPABASE_ANON_KEY` — anon no lee ninguna de las tres tablas privadas. (Si la tabla aún no existe en Supabase, el select anon devuelve vacío igual → 0 filas → pasa; tras aplicar el DDL sigue pasando por la policy DENY.) Si no hay anon key: SKIPPED.

- [ ] **Step 6: Correr el suite completo**

Run: `docker compose run --rm --workdir /app/backend backend npm test`
Expected: PASS, sin regresiones.

- [ ] **Step 7: Commit**

```bash
git add backend/db/schema.sql backend/src/privacy.integration.test.ts
git commit -m "feat(backend): tabla user_movie_state (privada, DENY anon) + test de privacidad"
```

---

### Task 2: Módulo `userMovieState.ts` (escritura, lectura, orden puro)

**Files:**
- Create: `backend/src/userMovieState.ts`
- Test: `backend/src/userMovieState.test.ts`

**Interfaces:**
- Consumes: `supabase` de `./db.js`.
- Produces:
  - `interface MovieState { pass_count: number; last_passed_at: string | null; last_liked_at: string | null }`
  - `recordMovieState(userId: string, movieId: string, liked: boolean): Promise<void>`
  - `getMovieStates(userId: string, movieIds: string[]): Promise<Map<string, MovieState>>`
  - `orderByNovelty<T extends { id: string }>(movies: T[], states: Map<string, MovieState>): T[]`

- [ ] **Step 1: Escribir los tests que fallan**

Create `backend/src/userMovieState.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let existingRow: any;     // fila leída por recordMovieState (maybeSingle)
let statesRows: any[];    // filas devueltas por getMovieStates (.in)
const upsertMock = vi.fn();

vi.mock('./db.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          // recordMovieState: .eq('user_id').eq('movie_id').maybeSingle()
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: existingRow }) }),
          // getMovieStates: .eq('user_id').in('movie_id', ids)
          in: () => Promise.resolve({ data: statesRows }),
        }),
      }),
      upsert: (payload: any) => { upsertMock(payload); return Promise.resolve({ error: null }); },
    }),
  },
}));

import { recordMovieState, getMovieStates, orderByNovelty } from './userMovieState.js';

beforeEach(() => {
  existingRow = null;
  statesRows = [];
  upsertMock.mockClear();
});

describe('recordMovieState', () => {
  it('pass en fila nueva: pass_count=1, last_passed_at seteado, last_liked_at null', async () => {
    existingRow = null;
    await recordMovieState('u1', 'm1', false);
    expect(upsertMock.mock.calls[0][0]).toMatchObject({
      user_id: 'u1', movie_id: 'm1', pass_count: 1, last_liked_at: null,
      last_passed_at: expect.any(String),
    });
  });

  it('pass en fila existente: incrementa pass_count y preserva last_liked_at', async () => {
    existingRow = { pass_count: 2, last_passed_at: '2026-01-01T00:00:00.000Z', last_liked_at: '2026-02-02T00:00:00.000Z' };
    await recordMovieState('u1', 'm1', false);
    expect(upsertMock.mock.calls[0][0]).toMatchObject({
      pass_count: 3, last_liked_at: '2026-02-02T00:00:00.000Z', last_passed_at: expect.any(String),
    });
  });

  it('like: setea last_liked_at y preserva pass_count + last_passed_at', async () => {
    existingRow = { pass_count: 2, last_passed_at: '2026-01-01T00:00:00.000Z', last_liked_at: null };
    await recordMovieState('u1', 'm1', true);
    expect(upsertMock.mock.calls[0][0]).toMatchObject({
      pass_count: 2, last_passed_at: '2026-01-01T00:00:00.000Z', last_liked_at: expect.any(String),
    });
  });
});

describe('getMovieStates', () => {
  it('arma el Map desde las filas', async () => {
    statesRows = [{ movie_id: 'm1', pass_count: 1, last_passed_at: 'x', last_liked_at: null }];
    const map = await getMovieStates('u1', ['m1', 'm2']);
    expect(map.get('m1')).toEqual({ pass_count: 1, last_passed_at: 'x', last_liked_at: null });
    expect(map.has('m2')).toBe(false);
  });

  it('movieIds vacío → Map vacío', async () => {
    const map = await getMovieStates('u1', []);
    expect(map.size).toBe(0);
  });
});

describe('orderByNovelty', () => {
  it('nunca-vistas primero; entre vistas last_passed_at asc (null = alta prioridad); pass_count desempata', () => {
    const movies = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const states = new Map([
      ['a', { pass_count: 1, last_passed_at: '2026-06-20T00:00:00.000Z', last_liked_at: null }],
      ['c', { pass_count: 1, last_passed_at: '2026-06-01T00:00:00.000Z', last_liked_at: null }],
      ['d', { pass_count: 0, last_passed_at: null, last_liked_at: '2026-06-10T00:00:00.000Z' }],
    ]);
    // b nunca vista → primero. Entre vistas: d (null=0) < c (jun-01) < a (jun-20).
    expect(orderByNovelty(movies, states).map((m) => m.id)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('mismo last_passed_at: menor pass_count primero', () => {
    const movies = [{ id: 'x' }, { id: 'y' }];
    const states = new Map([
      ['x', { pass_count: 3, last_passed_at: '2026-06-01T00:00:00.000Z', last_liked_at: null }],
      ['y', { pass_count: 1, last_passed_at: '2026-06-01T00:00:00.000Z', last_liked_at: null }],
    ]);
    expect(orderByNovelty(movies, states).map((m) => m.id)).toEqual(['y', 'x']);
  });

  it('sin estados preserva el orden de entrada; pool vacío → []', () => {
    const movies = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(orderByNovelty(movies, new Map()).map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(orderByNovelty([], new Map())).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `docker compose run --rm --workdir /app/backend backend npx vitest run src/userMovieState.test.ts`
Expected: FAIL — `Cannot find module './userMovieState.js'`.

- [ ] **Step 3: Implementar `userMovieState.ts`**

Create `backend/src/userMovieState.ts`:

```ts
// backend/src/userMovieState.ts
// Estado acumulado por usuaria cruzando sesiones, para ordenar el mazo por
// novedad. Privado: solo lo lee/escribe el backend (service role).
import { supabase } from './db.js';

export interface MovieState {
  pass_count: number;
  last_passed_at: string | null;
  last_liked_at: string | null;
}

// Registra un swipe en el estado acumulado. Read-modify-write (sin RPC; la
// concurrencia real es nula, una card a la vez). pass → incrementa pass_count y
// marca last_passed_at; like → marca last_liked_at. Preserva el otro timestamp.
export async function recordMovieState(
  userId: string, movieId: string, liked: boolean,
): Promise<void> {
  const { data: existing } = await supabase
    .from('user_movie_state')
    .select('pass_count, last_passed_at, last_liked_at')
    .eq('user_id', userId).eq('movie_id', movieId).maybeSingle();
  const now = new Date().toISOString();
  await supabase.from('user_movie_state').upsert({
    user_id: userId,
    movie_id: movieId,
    pass_count: (existing?.pass_count ?? 0) + (liked ? 0 : 1),
    last_passed_at: liked ? (existing?.last_passed_at ?? null) : now,
    last_liked_at: liked ? now : (existing?.last_liked_at ?? null),
  }, { onConflict: 'user_id,movie_id' });
}

// Estado de la usuaria para un set de pelis (las del deck filtrado).
export async function getMovieStates(
  userId: string, movieIds: string[],
): Promise<Map<string, MovieState>> {
  if (movieIds.length === 0) return new Map();
  const { data } = await supabase
    .from('user_movie_state')
    .select('movie_id, pass_count, last_passed_at, last_liked_at')
    .eq('user_id', userId).in('movie_id', movieIds);
  const map = new Map<string, MovieState>();
  for (const r of (data ?? []) as ({ movie_id: string } & MovieState)[]) {
    map.set(r.movie_id, {
      pass_count: r.pass_count,
      last_passed_at: r.last_passed_at,
      last_liked_at: r.last_liked_at,
    });
  }
  return map;
}

// Orden por novedad: nunca-vistas primero; entre vistas, pasadas hace más tiempo
// primero (last_passed_at null = época 0 = alta prioridad); desempate por menos
// pasadas. Sort estable → empate total preserva el orden de entrada.
export function orderByNovelty<T extends { id: string }>(
  movies: T[], states: Map<string, MovieState>,
): T[] {
  return [...movies].sort((a, b) => {
    const sa = states.get(a.id);
    const sb = states.get(b.id);
    const seenA = sa ? 1 : 0;
    const seenB = sb ? 1 : 0;
    if (seenA !== seenB) return seenA - seenB;
    const pa = sa?.last_passed_at ? Date.parse(sa.last_passed_at) : 0;
    const pb = sb?.last_passed_at ? Date.parse(sb.last_passed_at) : 0;
    if (pa !== pb) return pa - pb;
    return (sa?.pass_count ?? 0) - (sb?.pass_count ?? 0);
  });
}
```

- [ ] **Step 4: Correr y verificar verde**

Run: `docker compose run --rm --workdir /app/backend backend npx vitest run src/userMovieState.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Correr el suite completo**

Run: `docker compose run --rm --workdir /app/backend backend npm test`
Expected: PASS, sin regresiones.

- [ ] **Step 6: Commit**

```bash
git add backend/src/userMovieState.ts backend/src/userMovieState.test.ts
git commit -m "feat(backend): userMovieState — recordMovieState, getMovieStates, orderByNovelty"
```

---

### Task 3: Cableado en endpoints (`/swipe` registra estado, `/deck` ordena)

**Files:**
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `recordMovieState`, `getMovieStates`, `orderByNovelty` de `./userMovieState.js`.

- [ ] **Step 1: Importar el módulo**

En `backend/src/index.ts`, agregar a los imports:

```ts
import { recordMovieState, getMovieStates, orderByNovelty } from './userMovieState.js';
```

- [ ] **Step 2: `/deck` ordena por novedad**

En el handler `app.get('/deck', ...)`, reemplazar la línea final
`res.json({ deck: applyFilters(pool, filters), genres: collectGenres(pool), filters });`
por:

```ts
    const filtered = applyFilters(pool, filters);
    const states = await getMovieStates(userId, filtered.map((m) => m.id));
    res.json({ deck: orderByNovelty(filtered, states), genres: collectGenres(pool), filters });
```

(`pool`, `userId` y `filters` ya están en scope en ese handler. `genres` se sigue calculando del `pool` sin filtrar.)

- [ ] **Step 3: `/swipe` registra el estado**

En el handler `app.post('/swipe', ...)`, después de la línea
`const result = await recordSwipeAndDetectMatch(sessionId, userId, movieId, liked);`
agregar:

```ts
    await recordMovieState(userId, movieId, liked);
```

(Queda antes del `if (liked) await reconcileMatches(sessionId);`.)

- [ ] **Step 4: Build del backend**

Run: `docker compose run --rm --workdir /app/backend backend npm run build`
Expected: `tsc` sin errores.

- [ ] **Step 5: Correr el suite (regresión)**

Run: `docker compose run --rm --workdir /app/backend backend npm test`
Expected: PASS — los endpoints no tienen tests unitarios; el cambio se valida con build + suite + prueba manual.

- [ ] **Step 6: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(backend): /swipe registra user_movie_state; /deck ordena por novedad"
```

---

## Verificación manual (tras implementar, con el DDL aplicado en Supabase)
1. Aplicar la migración M4 de `schema.sql` en Supabase.
2. Swipear (pasar) algunas pelis; iniciar una **sesión nueva**: las pasadas en la sesión anterior deberían aparecer **al final** del mazo, y las nunca vistas primero.
3. Confirmar que nada se esconde (todas siguen apareciendo, solo cambia el orden).

## Fuera de alcance (anotado)
- `first_seen_at`/novedad-desde-la-watchlist (§3.2), hard cooldown, contador de cards.
- Aplicar el DDL en Supabase (lo hace el humano).
