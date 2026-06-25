# Novedad desde la watchlist (`first_seen_at`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar primero las películas recién agregadas a una watchlist, preservando `first_seen_at` con un refresh diff-based y ordenando el bucket "nunca-vistas" por recencia de alta.

**Architecture:** `watchlist_items` gana `first_seen_at`. `refreshWatchlistForUser` pasa de delete-all+insert a un diff (insertar nuevas con timestamp, no tocar las que siguen, borrar las que faltan) manteniendo la guardia de umbral. `orderByNovelty` suma un mapa `firstSeen` que ordena las nunca-vistas por alta más reciente. `/deck` arma ese mapa.

**Tech Stack:** Node 24 (alpine), TypeScript ESM, Express, `@supabase/supabase-js`, vitest. Sin frontend.

## Global Constraints

- **Todo corre en Docker. Nunca `npm`/`node` en el host.** Desde la raíz `/Users/jo/Documents/TheCinematicUs`:
  - backend suite: `docker compose run --rm --workdir /app/backend backend npm test`
  - backend 1 file: `docker compose run --rm --workdir /app/backend backend npx vitest run src/<archivo>.test.ts`
  - backend build: `docker compose run --rm --workdir /app/backend backend npm run build`
- **ESM:** imports internos con extensión `.js`.
- **Migraciones idempotentes:** DDL al final de `backend/db/schema.sql` con guardas, reflejado en el `create table` de cabecera. Se aplica a mano en Supabase (el implementador solo edita el archivo; NO se conecta a Supabase).
- **Commits normales por tarea, mensaje en español, estilo repo. NO trailer `Co-Authored-By: Claude`.**
- **Sin `last_seen_at`** (redundante: el refresh borra las que dejan la watchlist).
- **`orderByNovelty` 3er parámetro opcional** `firstSeen: Map<string, string> = new Map()` — para que los callers de 2 args sigan compilando hasta el cableado de `/deck`.
- **`firstSeen` por peli = máximo `first_seen_at`** entre sus filas (recién agregada por cualquiera = nueva). Strings ISO comparan cronológicamente.

---

### Task 1: Columna `first_seen_at` en `watchlist_items` (DDL)

**Files:**
- Modify: `backend/db/schema.sql`

**Interfaces:**
- Produces (DB): `watchlist_items.first_seen_at timestamptz not null default now()`.

- [ ] **Step 1: Agregar la columna al `create table watchlist_items` de cabecera**

En `backend/db/schema.sql`, en el `create table watchlist_items (...)`, agregar la columna:

```sql
create table watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  movie_id uuid not null references movies(id),
  first_seen_at timestamptz not null default now(),
  unique (user_id, movie_id)
);
```

(Si el `create table` de cabecera tiene otra forma exacta, agregar solo la línea `first_seen_at timestamptz not null default now(),` antes del `unique`.)

- [ ] **Step 2: Bloque de migración idempotente al final del archivo**

```sql
-- ─────────────────────────────────────────────────────────────
-- Migración M5 novedad watchlist (2026-06-25): first_seen_at en
-- watchlist_items para mostrar primero las pelis recién agregadas.
-- Las filas existentes backfillean a now() por el default.
-- ─────────────────────────────────────────────────────────────
alter table watchlist_items add column if not exists first_seen_at timestamptz not null default now();
```

- [ ] **Step 3: Correr el suite (no debe romper nada)**

Run: `docker compose run --rm --workdir /app/backend backend npm test`
Expected: PASS (cambio DDL-only, no afecta tests).

- [ ] **Step 4: Commit**

```bash
git add backend/db/schema.sql
git commit -m "feat(backend): watchlist_items.first_seen_at (para novedad desde la watchlist)"
```

---

### Task 2: `orderByNovelty` con `firstSeen` (novedad dentro de nunca-vistas)

**Files:**
- Modify: `backend/src/userMovieState.ts` (`orderByNovelty`)
- Test: `backend/src/userMovieState.test.ts` (agregar tests; los existentes quedan igual)

**Interfaces:**
- Produces: `orderByNovelty<T extends { id: string }>(movies: T[], states: Map<string, MovieState>, firstSeen?: Map<string, string>): T[]`.

- [ ] **Step 1: Escribir los tests nuevos (fallan)**

En `backend/src/userMovieState.test.ts`, dentro de `describe('orderByNovelty', ...)`, agregar:

```ts
  it('entre nunca-vistas, first_seen_at más reciente primero', () => {
    const movies = [{ id: 'vieja' }, { id: 'nueva' }, { id: 'media' }];
    const states = new Map(); // ninguna vista
    const firstSeen = new Map([
      ['vieja', '2026-01-01T00:00:00.000Z'],
      ['media', '2026-03-01T00:00:00.000Z'],
      ['nueva', '2026-06-01T00:00:00.000Z'],
    ]);
    expect(orderByNovelty(movies, states, firstSeen).map((m) => m.id)).toEqual(['nueva', 'media', 'vieja']);
  });

  it('una vista nunca pasa adelante de una nunca-vista, por más nueva que sea', () => {
    const movies = [{ id: 'vistaNueva' }, { id: 'nuncaVistaVieja' }];
    const states = new Map([
      ['vistaNueva', { pass_count: 1, last_passed_at: '2026-06-01T00:00:00.000Z', last_liked_at: null }],
    ]);
    const firstSeen = new Map([
      ['vistaNueva', '2026-06-20T00:00:00.000Z'],     // agregada muy reciente, pero ya vista
      ['nuncaVistaVieja', '2026-01-01T00:00:00.000Z'], // vieja, pero nunca vista
    ]);
    expect(orderByNovelty(movies, states, firstSeen).map((m) => m.id)).toEqual(['nuncaVistaVieja', 'vistaNueva']);
  });

  it('sin firstSeen (omitido) se comporta como M4: nunca-vistas en orden de entrada', () => {
    const movies = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(orderByNovelty(movies, new Map()).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });
```

- [ ] **Step 2: Correr y ver fallar**

Run: `docker compose run --rm --workdir /app/backend backend npx vitest run src/userMovieState.test.ts`
Expected: FAIL — el orden entre nunca-vistas hoy es de entrada (no por `first_seen_at`); el primer test nuevo falla.

- [ ] **Step 3: Extender `orderByNovelty`**

En `backend/src/userMovieState.ts`, reemplazar la función `orderByNovelty` por:

```ts
// Orden por novedad: nunca-vistas primero; entre nunca-vistas, recién agregadas
// a la watchlist primero (first_seen_at desc); entre vistas, pasadas hace más
// tiempo primero (last_passed_at null = época 0), desempate por menos pasadas.
// Sort estable → empate total preserva el orden de entrada.
export function orderByNovelty<T extends { id: string }>(
  movies: T[], states: Map<string, MovieState>, firstSeen: Map<string, string> = new Map(),
): T[] {
  return [...movies].sort((a, b) => {
    const sa = states.get(a.id);
    const sb = states.get(b.id);
    const seenA = sa ? 1 : 0;
    const seenB = sb ? 1 : 0;
    if (seenA !== seenB) return seenA - seenB;          // nunca-vistas primero
    if (seenA === 0) {                                   // ambas nunca-vistas
      const fa = firstSeen.get(a.id) ? Date.parse(firstSeen.get(a.id)!) : 0;
      const fb = firstSeen.get(b.id) ? Date.parse(firstSeen.get(b.id)!) : 0;
      return fb - fa;                                    // recién agregada primero
    }
    const pa = sa?.last_passed_at ? Date.parse(sa.last_passed_at) : 0;
    const pb = sb?.last_passed_at ? Date.parse(sb.last_passed_at) : 0;
    if (pa !== pb) return pa - pb;
    return (sa?.pass_count ?? 0) - (sb?.pass_count ?? 0);
  });
}
```

- [ ] **Step 4: Correr y verificar verde**

Run: `docker compose run --rm --workdir /app/backend backend npx vitest run src/userMovieState.test.ts`
Expected: PASS — los 8 tests M4 (siguen pasando con `firstSeen` por default vacío) + los 3 nuevos.

- [ ] **Step 5: Correr el suite completo**

Run: `docker compose run --rm --workdir /app/backend backend npm test`
Expected: PASS, sin regresiones (los callers de 2 args siguen compilando por el default).

- [ ] **Step 6: Commit**

```bash
git add backend/src/userMovieState.ts backend/src/userMovieState.test.ts
git commit -m "feat(backend): orderByNovelty ordena nunca-vistas por first_seen_at (recién agregadas primero)"
```

---

### Task 3: Refresh diff-based (`refreshWatchlistForUser`)

**Files:**
- Modify: `backend/src/watchlists.ts` (`refreshWatchlistForUser`)
- Test: `backend/src/watchlists.test.ts` (reescribir el mock y los tests del reemplazo)

**Interfaces:**
- Produces: `refreshWatchlistForUser(userId, url)` — misma firma/`RefreshResult`; ahora hace diff en vez de delete-all+insert.

- [ ] **Step 1: Reescribir el test (mock del diff + casos)**

Reemplazar **todo** `backend/src/watchlists.test.ts` por:

```ts
// backend/src/watchlists.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let scrapeResult: any;        // valor que devuelve scrapeWatchlist (o un Error a lanzar)
const deleteMock = vi.fn();   // ids pasados a .delete().eq().in(ids)
const insertMock = vi.fn();   // filas pasadas a .insert(rows)
let deleteError: any = null;
let insertError: any = null;
let currentItems: { movie_id: string }[] = [];

vi.mock('./letterboxd.js', () => ({
  scrapeWatchlist: vi.fn(() =>
    scrapeResult instanceof Error ? Promise.reject(scrapeResult) : Promise.resolve(scrapeResult),
  ),
}));

vi.mock('./movies.js', () => ({
  resolveMovie: vi.fn((title: string) => Promise.resolve({ id: `id-${title}` })),
}));

vi.mock('./db.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => Promise.resolve({ data: currentItems }) }),
      delete: () => ({
        eq: () => ({
          in: (_col: string, ids: string[]) => { deleteMock(ids); return Promise.resolve({ error: deleteError }); },
        }),
      }),
      insert: (rows: any[]) => { insertMock(rows); return Promise.resolve({ error: insertError }); },
    }),
  },
}));

import { refreshWatchlistForUser } from './watchlists.js';

beforeEach(() => {
  scrapeResult = [];
  deleteMock.mockClear();
  insertMock.mockClear();
  deleteError = null;
  insertError = null;
  currentItems = [];
});

describe('refreshWatchlistForUser', () => {
  it('primer load (sin set previo): inserta todas con first_seen_at, no borra', async () => {
    scrapeResult = [{ title: 'Drive', year: 2011 }, { title: 'Her', year: 2013 }, { title: 'Drive', year: 2011 }];
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 2, ok: true });
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith([
      { user_id: 'u1', movie_id: 'id-Drive', first_seen_at: expect.any(String) },
      { user_id: 'u1', movie_id: 'id-Her', first_seen_at: expect.any(String) },
    ]);
  });

  it('altas y bajas: inserta solo las nuevas, no re-inserta las que siguen, borra las que faltan', async () => {
    currentItems = [{ movie_id: 'id-A' }, { movie_id: 'id-B' }, { movie_id: 'id-C' }, { movie_id: 'id-D' }, { movie_id: 'id-E' }];
    scrapeResult = [{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' }, { title: 'New' }];
    // se va id-E (1 de 5 = 20% ≤ 40%) → procede; nueva = id-New
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 5, ok: true });
    expect(deleteMock).toHaveBeenCalledWith(['id-E']);
    expect(insertMock).toHaveBeenCalledWith([
      { user_id: 'u1', movie_id: 'id-New', first_seen_at: expect.any(String) },
    ]);
  });

  it('solo altas (nada se va): inserta las nuevas, no borra', async () => {
    currentItems = [{ movie_id: 'id-A' }];
    scrapeResult = [{ title: 'A' }, { title: 'B' }];
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 2, ok: true });
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith([
      { user_id: 'u1', movie_id: 'id-B', first_seen_at: expect.any(String) },
    ]);
  });

  it('mantiene el set anterior si el scrape eliminaría >40% del pozo', async () => {
    currentItems = Array.from({ length: 10 }, (_, i) => ({ movie_id: `id-old${i}` }));
    scrapeResult = [{ title: 'old0' }, { title: 'old1' }]; // se irían 8 (80%)
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r.ok).toBe(false);
    expect(r.kept).toBe(true);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('mantiene el set anterior si el scrape viene vacío', async () => {
    scrapeResult = [];
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 0, ok: false, error: 'scrape vacío' });
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('mantiene el set anterior si el scrape falla', async () => {
    scrapeResult = new Error('timeout');
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 0, ok: false, error: 'timeout' });
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('falla si la usuaria no tiene URL', async () => {
    const r = await refreshWatchlistForUser('u1', null);
    expect(r.ok).toBe(false);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('mantiene el set anterior si resolveMovie falla', async () => {
    scrapeResult = [{ title: 'Drive', year: 2011 }, { title: 'Her', year: 2013 }];
    const { resolveMovie } = await import('./movies.js');
    (resolveMovie as any).mockRejectedValueOnce(new Error('tmdb down'));
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('tmdb down');
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('falla si el delete da error (hay bajas)', async () => {
    currentItems = [{ movie_id: 'id-A' }, { movie_id: 'id-B' }, { movie_id: 'id-C' }, { movie_id: 'id-D' }, { movie_id: 'id-E' }];
    scrapeResult = [{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' }]; // se va id-E (20%)
    deleteError = { message: 'db connection lost' };
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 0, ok: false, error: 'db connection lost' });
    expect(deleteMock).toHaveBeenCalledWith(['id-E']);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('falla si el insert da error (hay altas)', async () => {
    currentItems = [{ movie_id: 'id-A' }];
    scrapeResult = [{ title: 'A' }, { title: 'B' }];
    insertError = { message: 'constraint violation' };
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 0, ok: false, error: 'constraint violation' });
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `docker compose run --rm --workdir /app/backend backend npx vitest run src/watchlists.test.ts`
Expected: FAIL — el código actual hace delete-all+insert (sin `.in()`, sin `first_seen_at`); los nuevos asserts fallan.

- [ ] **Step 3: Reescribir el reemplazo en `refreshWatchlistForUser`**

En `backend/src/watchlists.ts`, reemplazar el bloque de reemplazo (desde el comentario `// Reemplazo atómico-suficiente...` y los dos bloques `delete`/`insert` hasta el `return` final) por:

```ts
  // Diff-based: insertar las nuevas (con first_seen_at), no tocar las que siguen
  // (preservan su first_seen_at), borrar las que ya no están.
  const now = new Date().toISOString();
  const newSet = new Set(uniqueIds);
  const toInsert = uniqueIds.filter((id) => !prevIds.has(id));
  const toDelete = [...prevIds].filter((id) => !newSet.has(id));

  if (toDelete.length > 0) {
    const { error: delErr } = await supabase
      .from('watchlist_items').delete().eq('user_id', userId).in('movie_id', toDelete);
    if (delErr) return { count: 0, ok: false, error: delErr.message };
  }
  if (toInsert.length > 0) {
    const { error: insErr } = await supabase
      .from('watchlist_items')
      .insert(toInsert.map((movie_id) => ({ user_id: userId, movie_id, first_seen_at: now })));
    if (insErr) return { count: 0, ok: false, error: insErr.message };
  }

  return { count: uniqueIds.length, ok: true };
```

(`prevIds` ya está calculado arriba para la guardia de umbral; se reutiliza. La lectura del set actual `select('movie_id')` no cambia.)

- [ ] **Step 4: Correr y verificar verde**

Run: `docker compose run --rm --workdir /app/backend backend npx vitest run src/watchlists.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Correr el suite completo + build**

Run: `docker compose run --rm --workdir /app/backend backend npm test`
Run: `docker compose run --rm --workdir /app/backend backend npm run build`
Expected: PASS + `tsc` limpio.

- [ ] **Step 6: Commit**

```bash
git add backend/src/watchlists.ts backend/src/watchlists.test.ts
git commit -m "feat(backend): refresh diff-based de watchlists (preserva first_seen_at, borra solo las que faltan)"
```

---

### Task 4: `/deck` arma `firstSeen` y lo pasa a `orderByNovelty`

**Files:**
- Modify: `backend/src/index.ts` (handler `/deck`)

**Interfaces:**
- Consumes: `orderByNovelty(filtered, states, firstSeen)` de `./userMovieState.js`.

- [ ] **Step 1: Cargar `first_seen_at` y armar el mapa en `/deck`**

En `backend/src/index.ts`, en el handler `app.get('/deck', ...)`:

Reemplazar la carga de `watchlist_items` y la derivación de `movieIds`:

```ts
    const { data: items } = await supabase
      .from('watchlist_items').select('movie_id, first_seen_at');
    // firstSeen por peli = máximo first_seen_at entre sus filas (recién agregada
    // por cualquiera de las dos = nueva). Las cadenas ISO comparan cronológicamente.
    const firstSeen = new Map<string, string>();
    for (const it of (items ?? []) as { movie_id: string; first_seen_at: string }[]) {
      const cur = firstSeen.get(it.movie_id);
      if (!cur || it.first_seen_at > cur) firstSeen.set(it.movie_id, it.first_seen_at);
    }
    const movieIds = [...firstSeen.keys()];
```

(Reemplaza las líneas actuales `const { data: items } = await supabase.from('watchlist_items').select('movie_id');` y `const movieIds = [...new Set((items ?? []).map((i) => i.movie_id))];`.)

- [ ] **Step 2: Pasar `firstSeen` al orden**

Reemplazar la línea final del handler `res.json({ deck: orderByNovelty(filtered, states), genres: collectGenres(pool), filters });` por:

```ts
    res.json({ deck: orderByNovelty(filtered, states, firstSeen), genres: collectGenres(pool), filters });
```

(`filtered`, `states`, `pool`, `filters` ya están en scope desde M4.)

- [ ] **Step 3: Build del backend**

Run: `docker compose run --rm --workdir /app/backend backend npm run build`
Expected: `tsc` sin errores.

- [ ] **Step 4: Correr el suite (regresión)**

Run: `docker compose run --rm --workdir /app/backend backend npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(backend): /deck ordena por novedad de watchlist (firstSeen máximo por peli)"
```

---

## Verificación manual (tras implementar, con el DDL aplicado en Supabase)
1. Aplicar la migración M5 de `schema.sql` (columna `first_seen_at`).
2. Refrescar las watchlists (las existentes quedan con `first_seen_at` ~ahora).
3. Agregar una peli nueva a una watchlist en Letterboxd, refrescar: debería aparecer entre las primeras del mazo (nunca-vista + recién agregada).
4. Confirmar que las que siguen en la watchlist conservan su `first_seen_at` (no saltan al frente tras un refresh que no las tocó).

## Fuera de alcance (anotado)
- `last_seen_at`, `watchlist_history`, eventos de "removida".
- Aplicar el DDL en Supabase (lo hace el humano).
