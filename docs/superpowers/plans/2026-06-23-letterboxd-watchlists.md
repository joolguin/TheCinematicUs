# Watchlists desde Letterboxd Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la carga manual de títulos por un pozo de películas persistente que se arma scrapeando las watchlists públicas de Letterboxd de ambas usuarias, disparado por un botón manual.

**Architecture:** Un módulo aislado `letterboxd.ts` scrapea el HTML público paginado de cada watchlist. Un módulo `watchlists.ts` orquesta el refresh con semántica *replace-on-success* por usuaria, resolviendo cada film con el `resolveMovie` existente (cache + TMDB). `watchlist_items` se desacopla de las sesiones y pasa a ser persistente por usuaria. El `/deck` une los pozos de ambas y resta lo ya swipeado en la sesión activa. El frontend reemplaza la pantalla `Import` por `Watchlists`.

**Tech Stack:** Node + Express + TypeScript, Supabase (service role), Vitest, React + Vite, Tailwind.

## Global Constraints

- **Docker only.** Nunca correr `npm`/`node`/`vitest` en el host. Todo comando de test/build corre dentro del contenedor (ej. `docker compose run --rm backend npm test`). Ver `docker-compose.yml`.
- **Privacidad de likes intacta.** `swipes` y `watchlist_items` siguen SIN policy para anon. Solo el backend (service role) los lee/escribe. No agregar policies anon a esas tablas.
- **El match es ocasional.** La sesión sigue reseteando swipes/matches. El pozo (`watchlist_items`) es persistente y NO se scopea por sesión.
- **Replace-on-success por usuaria.** Un scrape con ≥1 film reemplaza el set de esa usuaria. Un scrape vacío o con error mantiene el set anterior. Las dos usuarias se procesan de forma independiente.
- **Módulo de scraping aislado.** Toda dependencia del HTML de Letterboxd vive solo en `backend/src/letterboxd.ts`.
- **Sin co-author trailer de Claude** en los commits.
- ESM: los imports internos del backend usan extensión `.js` (ej. `import { x } from './letterboxd.js'`).

---

## File Structure

- `backend/db/schema.sql` — MODIFY: agregar `users.letterboxd_url`; migración idempotente que desacopla `watchlist_items` de sesiones y crea índice único `(user_id, movie_id)`.
- `backend/src/letterboxd.ts` — NEW: `parseWatchlistPage(html)` (puro) + `scrapeWatchlist(url)` (paginación + fetch). Único lugar acoplado al HTML de Letterboxd.
- `backend/src/letterboxd.test.ts` — NEW: tests del parser y de la paginación.
- `backend/src/watchlists.ts` — NEW: `refreshWatchlistForUser(...)` y `refreshAllWatchlists()` con replace-on-success.
- `backend/src/watchlists.test.ts` — NEW: tests de la lógica de replace-on-success.
- `backend/src/users.ts` — MODIFY: agregar `getUsersWithLetterboxd()`.
- `backend/src/index.ts` — MODIFY: agregar `POST /watchlists/refresh`; cambiar `/deck` (unión de pozos persistentes); eliminar `POST /import`.
- `frontend/src/screens/Watchlists.tsx` — NEW: pantalla que reemplaza a `Import`.
- `frontend/src/screens/Import.tsx` — DELETE.
- `frontend/src/App.tsx` — MODIFY: routing `Gate → UserSelect → Swipe`; `Watchlists` alcanzable desde Swipe.
- `frontend/src/screens/Swipe.tsx` — MODIFY: accesos a `Watchlists` (header + estado de mazo vacío).

---

## Task 1: Migración de DB (schema)

**Files:**
- Modify: `backend/db/schema.sql` (append al final del archivo)

**Interfaces:**
- Produces: tabla `watchlist_items (id, user_id, movie_id)` con único `(user_id, movie_id)`, sin `session_id`. Columna `users.letterboxd_url text` (nullable).

Esta tarea es SQL idempotente que se ejecuta a mano en el SQL editor de Supabase. No tiene ciclo de test automatizado; la verificación es manual.

- [ ] **Step 1: Append la migración al final de `backend/db/schema.sql`**

```sql

-- ─────────────────────────────────────────────────────────────
-- Migración watchlists Letterboxd (2026-06-23) — idempotente.
-- Aplicar sobre la DB existente.
-- ─────────────────────────────────────────────────────────────

-- 1) URL de watchlist pública por usuaria (se setea a mano).
alter table users add column if not exists letterboxd_url text;
update users set letterboxd_url = 'https://letterboxd.com/<jo>/watchlist/' where name = 'Jo';
update users set letterboxd_url = 'https://letterboxd.com/<vale>/watchlist/' where name = 'Vale';

-- 2) Desacoplar watchlist_items de sesiones → pozo persistente por usuaria.
alter table watchlist_items drop constraint if exists watchlist_items_session_id_fkey;
-- el set viejo estaba scopeado por sesión; ya no aplica
delete from watchlist_items;
alter table watchlist_items drop column if exists session_id;

-- 3) Nueva unicidad: una fila por (usuaria, película).
create unique index if not exists watchlist_items_user_movie
  on watchlist_items (user_id, movie_id);
```

- [ ] **Step 2: (Manual) Ejecutar el bloque en el SQL editor de Supabase y setear las URLs reales**

Reemplazar `<jo>` y `<vale>` por los usernames reales de Letterboxd. Verificación: `select name, letterboxd_url from users;` muestra ambas URLs, y `\d watchlist_items` ya no tiene `session_id`.

- [ ] **Step 3: Commit**

```bash
git add backend/db/schema.sql
git commit -m "feat(db): desacoplar watchlist_items de sesiones + letterboxd_url"
```

---

## Task 2: Parser de página de watchlist

**Files:**
- Create: `backend/src/letterboxd.ts`
- Test: `backend/src/letterboxd.test.ts`

**Interfaces:**
- Produces:
  - `interface ScrapedFilm { title: string; year: number | null; }`
  - `parseWatchlistPage(html: string): ScrapedFilm[]` — extrae los films de una página HTML. Título desde el `alt` del `<img>`; año desde el sufijo `-YYYY` del `data-film-slug` si está, si no `null`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/src/letterboxd.test.ts`:

```ts
// backend/src/letterboxd.test.ts
import { describe, it, expect } from 'vitest';
import { parseWatchlistPage } from './letterboxd.js';

const PAGE = `
<ul class="poster-list">
  <li class="poster-container">
    <div class="film-poster" data-film-slug="parasite-2019">
      <img class="image" alt="Parasite" />
    </div>
  </li>
  <li class="poster-container">
    <div class="film-poster" data-film-slug="amelie">
      <img class="image" alt="Am&eacute;lie" />
    </div>
  </li>
</ul>
`;

describe('parseWatchlistPage', () => {
  it('extrae título y año del slug', () => {
    expect(parseWatchlistPage(PAGE)).toEqual([
      { title: 'Parasite', year: 2019 },
      { title: 'Amélie', year: null },
    ]);
  });

  it('devuelve [] en una página sin posters', () => {
    expect(parseWatchlistPage('<ul class="poster-list"></ul>')).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `docker compose run --rm backend npx vitest run src/letterboxd.test.ts`
Expected: FAIL — `parseWatchlistPage is not a function` / módulo inexistente.

- [ ] **Step 3: Implementar el parser**

Crear `backend/src/letterboxd.ts`:

```ts
// backend/src/letterboxd.ts
// ÚNICO módulo acoplado al HTML de Letterboxd. Si cambia el markup, se arregla acá.

export interface ScrapedFilm {
  title: string;
  year: number | null;
}

// Cada poster expone `data-film-slug="..."` y, más adelante en el mismo bloque,
// un <img ... alt="Título">. El non-greedy puentea del slug al próximo alt.
const FILM_RE = /data-film-slug="([^"]*)"[\s\S]*?<img\b[^>]*\balt="([^"]*)"/g;

// Desescapa las entidades HTML más comunes en títulos.
function unescapeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&agrave;/g, 'à')
    .replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó')
    .replace(/&uacute;/g, 'ú')
    .replace(/&ntilde;/g, 'ñ');
}

export function parseWatchlistPage(html: string): ScrapedFilm[] {
  const films: ScrapedFilm[] = [];
  for (const m of html.matchAll(FILM_RE)) {
    const slug = m[1];
    const title = unescapeHtml(m[2]).trim();
    if (!title) continue;
    const yearMatch = slug.match(/-(\d{4})$/);
    const year = yearMatch ? Number(yearMatch[1]) : null;
    films.push({ title, year });
  }
  return films;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `docker compose run --rm backend npx vitest run src/letterboxd.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/letterboxd.ts backend/src/letterboxd.test.ts
git commit -m "feat(backend): parser de página de watchlist de Letterboxd"
```

---

## Task 3: Scraping paginado de la watchlist

**Files:**
- Modify: `backend/src/letterboxd.ts`
- Test: `backend/src/letterboxd.test.ts`

**Interfaces:**
- Consumes: `parseWatchlistPage`, `ScrapedFilm` (Task 2).
- Produces: `scrapeWatchlist(url: string): Promise<ScrapedFilm[]>` — recorre `…/watchlist/`, `…/watchlist/page/2/`, … hasta una página sin posters (o tope de seguridad). Devuelve films deduplicados por `título|año`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/src/letterboxd.test.ts`:

```ts
import { afterEach, vi } from 'vitest';
import { scrapeWatchlist } from './letterboxd.js';

afterEach(() => vi.unstubAllGlobals());

function htmlFor(slugs: string[]): string {
  return slugs
    .map((s) => `<div class="film-poster" data-film-slug="${s}"><img alt="${s}" /></div>`)
    .join('');
}

describe('scrapeWatchlist', () => {
  it('recorre páginas hasta una vacía y deduplica', async () => {
    const pages: Record<string, string> = {
      'https://letterboxd.com/jo/watchlist/': htmlFor(['drive-2011', 'parasite-2019']),
      'https://letterboxd.com/jo/watchlist/page/2/': htmlFor(['parasite-2019', 'her-2013']),
      'https://letterboxd.com/jo/watchlist/page/3/': '<ul></ul>',
    };
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({ ok: true, text: () => Promise.resolve(pages[url] ?? '<ul></ul>') }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const films = await scrapeWatchlist('https://letterboxd.com/jo/watchlist/');
    expect(films).toEqual([
      { title: 'drive-2011', year: 2011 },
      { title: 'parasite-2019', year: 2019 },
      { title: 'her-2013', year: 2013 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('corta si una página responde con error HTTP', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, text: () => Promise.resolve('') }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await scrapeWatchlist('https://letterboxd.com/jo/watchlist/')).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `docker compose run --rm backend npx vitest run src/letterboxd.test.ts`
Expected: FAIL — `scrapeWatchlist is not a function`.

- [ ] **Step 3: Implementar `scrapeWatchlist`**

Agregar al final de `backend/src/letterboxd.ts`:

```ts
const MAX_PAGES = 50; // tope de seguridad ante un bucle inesperado
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Recorre las páginas de la watchlist hasta una vacía. Devuelve films deduplicados.
export async function scrapeWatchlist(url: string): Promise<ScrapedFilm[]> {
  const base = url.endsWith('/') ? url : url + '/';
  const seen = new Map<string, ScrapedFilm>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageUrl = page === 1 ? base : `${base}page/${page}/`;
    const res = await fetch(pageUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) break;
    const films = parseWatchlistPage(await res.text());
    if (films.length === 0) break;
    for (const f of films) {
      const key = `${f.title.toLowerCase()}|${f.year ?? ''}`;
      if (!seen.has(key)) seen.set(key, f);
    }
  }
  return [...seen.values()];
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `docker compose run --rm backend npx vitest run src/letterboxd.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/letterboxd.ts backend/src/letterboxd.test.ts
git commit -m "feat(backend): scraping paginado de watchlist con dedup"
```

---

## Task 4: Listar usuarias con su URL de Letterboxd

**Files:**
- Modify: `backend/src/users.ts`

**Interfaces:**
- Produces: `getUsersWithLetterboxd(): Promise<{ id: string; name: string; letterboxd_url: string | null }[]>` — devuelve todas las usuarias con su URL.

Esta función es un wrapper directo de Supabase, sin lógica. Se cubre vía los tests de la orquestación (Task 5) y se verifica con typecheck. No lleva test unitario propio.

- [ ] **Step 1: Agregar la función a `backend/src/users.ts`**

```ts
export interface UserWithLetterboxd {
  id: string;
  name: string;
  letterboxd_url: string | null;
}

export async function getUsersWithLetterboxd(): Promise<UserWithLetterboxd[]> {
  const { data, error } = await supabase
    .from('users').select('id, name, letterboxd_url');
  if (error) {
    console.error('[getUsersWithLetterboxd] error de Supabase:', error);
    throw new Error(`Error listando usuarias: ${error.message}`);
  }
  return data ?? [];
}
```

- [ ] **Step 2: Typecheck**

Run: `docker compose run --rm backend npm run build`
Expected: compila sin errores.

- [ ] **Step 3: Commit**

```bash
git add backend/src/users.ts
git commit -m "feat(backend): getUsersWithLetterboxd"
```

---

## Task 5: Orquestación del refresh (replace-on-success)

**Files:**
- Create: `backend/src/watchlists.ts`
- Test: `backend/src/watchlists.test.ts`

**Interfaces:**
- Consumes: `scrapeWatchlist` (Task 3), `resolveMovie` (`./movies.js`), `getUsersWithLetterboxd` (Task 4), `supabase` (`./db.js`).
- Produces:
  - `interface RefreshResult { count: number; ok: boolean; error?: string; }`
  - `refreshWatchlistForUser(userId: string, url: string | null): Promise<RefreshResult>` — scrapea, resuelve y reemplaza el set de esa usuaria solo si hubo ≥1 film. Vacío/error → mantiene el set anterior.
  - `refreshAllWatchlists(): Promise<Record<string, RefreshResult>>` — corre el refresh por cada usuaria, indexado por `name`. Independiente por usuaria.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `backend/src/watchlists.test.ts`:

```ts
// backend/src/watchlists.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let scrapeResult: any;        // valor que devuelve scrapeWatchlist (o un Error a lanzar)
const deleteMock = vi.fn();
const insertMock = vi.fn();

vi.mock('./letterboxd.js', () => ({
  scrapeWatchlist: vi.fn(() =>
    scrapeResult instanceof Error ? Promise.reject(scrapeResult) : Promise.resolve(scrapeResult),
  ),
}));

vi.mock('./movies.js', () => ({
  // resuelve cada título a un id determinístico
  resolveMovie: vi.fn((title: string) => Promise.resolve({ id: `id-${title}` })),
}));

vi.mock('./db.js', () => ({
  supabase: {
    from: () => ({
      delete: () => { deleteMock(); return { eq: () => Promise.resolve({ error: null }) }; },
      insert: (...a: any[]) => { insertMock(...a); return Promise.resolve({ error: null }); },
    }),
  },
}));

import { refreshWatchlistForUser } from './watchlists.js';

beforeEach(() => {
  scrapeResult = [];
  deleteMock.mockClear();
  insertMock.mockClear();
});

describe('refreshWatchlistForUser', () => {
  it('reemplaza el set cuando el scrape trae films', async () => {
    scrapeResult = [
      { title: 'Drive', year: 2011 },
      { title: 'Her', year: 2013 },
      { title: 'Drive', year: 2011 }, // duplicado
    ];
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 2, ok: true });
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith([
      { user_id: 'u1', movie_id: 'id-Drive' },
      { user_id: 'u1', movie_id: 'id-Her' },
    ]);
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
  });

  it('falla si la usuaria no tiene URL', async () => {
    const r = await refreshWatchlistForUser('u1', null);
    expect(r.ok).toBe(false);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `docker compose run --rm backend npx vitest run src/watchlists.test.ts`
Expected: FAIL — módulo `./watchlists.js` inexistente.

- [ ] **Step 3: Implementar `watchlists.ts`**

Crear `backend/src/watchlists.ts`:

```ts
// backend/src/watchlists.ts
import { supabase } from './db.js';
import { scrapeWatchlist } from './letterboxd.js';
import { resolveMovie } from './movies.js';
import { getUsersWithLetterboxd } from './users.js';

export interface RefreshResult {
  count: number;
  ok: boolean;
  error?: string;
}

// Replace-on-success: solo reemplaza el set si el scrape trajo ≥1 película.
export async function refreshWatchlistForUser(
  userId: string,
  url: string | null,
): Promise<RefreshResult> {
  if (!url) return { count: 0, ok: false, error: 'sin URL de Letterboxd' };

  let films;
  try {
    films = await scrapeWatchlist(url);
  } catch (e: any) {
    return { count: 0, ok: false, error: e.message };
  }
  if (films.length === 0) return { count: 0, ok: false, error: 'scrape vacío' };

  // Resolver cada film (cache + TMDB) y deduplicar por movie_id.
  const ids: string[] = [];
  for (const f of films) {
    const { id } = await resolveMovie(f.title, f.year);
    ids.push(id);
  }
  const uniqueIds = [...new Set(ids)];

  // Reemplazo atómico-suficiente: borrar el set de la usuaria e insertar el nuevo.
  await supabase.from('watchlist_items').delete().eq('user_id', userId);
  await supabase
    .from('watchlist_items')
    .insert(uniqueIds.map((movie_id) => ({ user_id: userId, movie_id })));

  return { count: uniqueIds.length, ok: true };
}

// Procesa todas las usuarias de forma independiente: una puede fallar sin frenar a la otra.
export async function refreshAllWatchlists(): Promise<Record<string, RefreshResult>> {
  const users = await getUsersWithLetterboxd();
  const out: Record<string, RefreshResult> = {};
  for (const u of users) {
    out[u.name] = await refreshWatchlistForUser(u.id, u.letterboxd_url);
  }
  return out;
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `docker compose run --rm backend npx vitest run src/watchlists.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/watchlists.ts backend/src/watchlists.test.ts
git commit -m "feat(backend): refresh de watchlists con replace-on-success"
```

---

## Task 6: Endpoint `POST /watchlists/refresh` + `/deck` persistente + quitar `/import`

**Files:**
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `refreshAllWatchlists` (Task 5).
- Produces:
  - `POST /watchlists/refresh` → `Record<string, { count, ok, error? }>` (clave = nombre de usuaria).
  - `GET /deck?user=<name>` → `{ deck: Movie[] }` ahora desde el pozo persistente de todas las usuarias menos lo swipeado en la sesión activa.

Cambios de wiring en endpoints existentes; la lógica testeable ya está cubierta en Tasks 3/5. Verificación por typecheck/build y, al final, la suite completa.

- [ ] **Step 1: Reemplazar el import y el endpoint `/import`**

En `backend/src/index.ts`, cambiar el bloque de imports superior:

```ts
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { requirePassphrase } from './middleware/auth.js';
import { supabase } from './db.js';
import { resolveMovie } from './movies.js';
import { getActiveSession, createSession } from './sessions.js';
import { recordSwipeAndDetectMatch, reconcileMatches } from './match.js';
import { getUserByName } from './users.js';
import { refreshAllWatchlists } from './watchlists.js';
```

(Se eliminan los imports `parseTitleLine` y, si `resolveMovie` deja de usarse, también el suyo — ver Step siguiente.)

- [ ] **Step 2: Eliminar el endpoint `/import` y agregar `/watchlists/refresh`**

Borrar todo el bloque `app.post('/import', …)` (líneas del handler de import) y reemplazarlo por:

```ts
// Refresca el pozo scrapeando ambas watchlists de Letterboxd. Replace-on-success por usuaria.
// Síncrono: el primer scrape (cache fría) puede tardar; el frontend muestra spinner.
app.post('/watchlists/refresh', async (_req, res) => {
  try {
    res.json(await refreshAllWatchlists());
  } catch (e: any) {
    console.error('[error endpoint]', e);
    res.status(500).json({ error: e.message });
  }
});
```

Nota: `resolveMovie` ya no se usa directamente en `index.ts` (lo usa `watchlists.ts`). Quitar su import del Step 1 para que el build no falle por import sin uso si `noUnusedLocals` está activo. Si el build se queja, eliminá la línea `import { resolveMovie } from './movies.js';`.

- [ ] **Step 3: Actualizar `/deck` al pozo persistente**

Reemplazar el cuerpo del handler `app.get('/deck', …)` por:

```ts
// Mazo pendiente: unión de las watchlists persistentes de TODAS las usuarias
// menos lo que esta usuaria ya swipeó en la sesión activa.
app.get('/deck', async (req, res) => {
  try {
    const { id: userId } = await getUserByName(String(req.query.user));
    const { id: sessionId } = await getActiveSession();

    const { data: items } = await supabase
      .from('watchlist_items').select('movie_id');
    const movieIds = [...new Set((items ?? []).map((i) => i.movie_id))];

    const { data: swiped } = await supabase
      .from('swipes').select('movie_id').eq('session_id', sessionId).eq('user_id', userId);
    const swipedIds = new Set((swiped ?? []).map((s) => s.movie_id));

    const pending = movieIds.filter((id) => !swipedIds.has(id));
    const { data: movies } = await supabase.from('movies').select('*').in('id', pending);
    res.json({ deck: movies ?? [] });
  } catch (e: any) {
    console.error('[error endpoint]', e);
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 4: Build + suite completa del backend**

Run: `docker compose run --rm backend npm run build`
Expected: compila sin errores.

Run: `docker compose run --rm backend npm test`
Expected: PASS — toda la suite (incluye letterboxd y watchlists).

- [ ] **Step 5: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(backend): endpoint /watchlists/refresh + deck persistente, quita /import"
```

---

## Task 7: Pantalla Watchlists (frontend)

**Files:**
- Create: `frontend/src/screens/Watchlists.tsx`
- Delete: `frontend/src/screens/Import.tsx`

**Interfaces:**
- Consumes: `api` (`../api`).
- Produces: `Watchlists({ onDone }: { onDone: () => void })` — botón "Actualizar watchlists" (`POST /watchlists/refresh`, con spinner), línea de resultado por usuaria, y botón "Empezar a swipear".

Respuesta de `/watchlists/refresh` tipada como `Record<string, { count: number; ok: boolean; error?: string }>`.

- [ ] **Step 1: Crear `frontend/src/screens/Watchlists.tsx`**

```tsx
// frontend/src/screens/Watchlists.tsx
import { useState } from 'react';
import { api } from '../api';

type RefreshResult = { count: number; ok: boolean; error?: string };
type RefreshResponse = Record<string, RefreshResult>;

export function Watchlists({ onDone }: { onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RefreshResponse | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setResult(await api.post('/watchlists/refresh', {}));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col gap-4 p-6 max-w-md mx-auto">
      <h2 className="text-xl">Watchlists de Letterboxd</h2>
      <p className="text-sm text-neutral-500">
        Trae el pozo de películas desde las watchlists públicas. La primera vez puede tardar.
      </p>

      <button
        onClick={refresh}
        disabled={loading}
        className="rounded-lg bg-rose-600 px-6 py-3 font-medium disabled:opacity-40"
      >
        {loading ? 'Actualizando…' : 'Actualizar watchlists'}
      </button>

      {result && (
        <div className="flex flex-col gap-1 text-sm">
          {Object.entries(result).map(([name, r]) => (
            <p key={name} className={r.ok ? 'text-neutral-300' : 'text-amber-400'}>
              {r.ok
                ? `${name}: ${r.count} ✓`
                : `${name}: error — se mantuvo la lista anterior${r.error ? ` (${r.error})` : ''}`}
            </p>
          ))}
        </div>
      )}

      <button
        onClick={onDone}
        disabled={loading}
        className="mt-2 rounded-lg bg-emerald-600 px-6 py-3 font-medium text-neutral-100 disabled:opacity-40"
      >
        Empezar a swipear
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Borrar la pantalla vieja**

```bash
git rm frontend/src/screens/Import.tsx
```

- [ ] **Step 3: Typecheck del frontend**

Run: `docker compose run --rm frontend npx tsc -b`
Expected: errores SOLO en `App.tsx`/`Swipe.tsx` por la referencia rota a `Import` (se arreglan en Task 8). Si preferís, encadená Task 8 antes de typechequear.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screens/Watchlists.tsx
git commit -m "feat(frontend): pantalla Watchlists reemplaza a Import"
```

---

## Task 8: Routing y accesos desde Swipe (frontend)

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/screens/Swipe.tsx`

**Interfaces:**
- Consumes: `Watchlists` (Task 7).
- Produces: routing `Gate → UserSelect → Swipe`; `Watchlists` alcanzable desde Swipe (header + estado de mazo vacío) vía prop `onWatchlists`.

- [ ] **Step 1: Reescribir `frontend/src/App.tsx`**

```tsx
// frontend/src/App.tsx
import { useState } from 'react';
import './index.css';
import { Gate } from './screens/Gate';
import { UserSelect } from './screens/UserSelect';
import { Watchlists } from './screens/Watchlists';
import { Swipe } from './screens/Swipe';
import type { UserName } from './types';

type Screen = 'gate' | 'user' | 'watchlists' | 'swipe';

function storedUser(): UserName | null {
  const u = localStorage.getItem('user');
  return u === 'Jo' || u === 'Vale' ? u : null;
}

function initialScreen(): Screen {
  if (!localStorage.getItem('passphrase')) return 'gate';
  return storedUser() ? 'swipe' : 'user';
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [user, setUser] = useState<UserName | null>(storedUser);

  // Elegir usuaria: se recuerda. Las watchlists persisten, así que va directo a swipear.
  function pick(u: UserName) {
    localStorage.setItem('user', u);
    setUser(u);
    setScreen('swipe');
  }

  // Cambiar usuaria: olvida la elección y vuelve a seleccionar.
  function switchUser() {
    localStorage.removeItem('user');
    setUser(null);
    setScreen('user');
  }

  if (screen === 'gate') return <Gate onOk={() => setScreen('user')} />;
  if (screen === 'user') return <UserSelect onPick={pick} />;
  if (screen === 'watchlists') return <Watchlists onDone={() => setScreen('swipe')} />;
  if (screen === 'swipe' && user)
    return <Swipe user={user} onSwitch={switchUser} onWatchlists={() => setScreen('watchlists')} />;
  return null;
}
```

- [ ] **Step 2: Actualizar la firma y los accesos en `frontend/src/screens/Swipe.tsx`**

Cambiar la firma del componente (línea 15):

```tsx
export function Swipe({ user, onSwitch, onWatchlists }: { user: UserName; onSwitch: () => void; onWatchlists: () => void }) {
```

En el header, agregar la afordancia para refrescar el pozo antes de empezar. Reemplazar el bloque de botones del header (el `<div className="flex items-center gap-3">…</div>`) por:

```tsx
        <div className="flex items-center gap-3">
          <button onClick={onWatchlists} className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm">🎬 Watchlists</button>
          <button onClick={confirmarNuevaSesion} className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm">🔄 Nueva sesión</button>
          <button onClick={() => setShowMatches(true)} className="text-lg">❤️ {matchCount}</button>
        </div>
```

En el estado de mazo vacío, reemplazar el texto y el botón de import. Cambiar:

```tsx
            <div className="text-sm text-neutral-500">¿Sesión nueva o sin películas? Importa tu watchlist.</div>
            <button onClick={onImport} className="rounded-lg bg-neutral-800 px-4 py-2 text-sm">Importar películas</button>
```

por:

```tsx
            <div className="text-sm text-neutral-500">¿Sesión nueva o pozo vacío? Actualizá las watchlists.</div>
            <button onClick={onWatchlists} className="rounded-lg bg-neutral-800 px-4 py-2 text-sm">Actualizar watchlists</button>
```

- [ ] **Step 3: Typecheck + build del frontend**

Run: `docker compose run --rm frontend npx tsc -b`
Expected: sin errores.

Run: `docker compose run --rm frontend npm run build`
Expected: build OK.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/screens/Swipe.tsx
git commit -m "feat(frontend): routing a Swipe + accesos a Watchlists"
```

---

## Notas de deferral (alineadas con el spec)

- **Broadcast automático del pozo + aviso "se actualizó el pozo":** queda como mejora futura (igual que el broadcast de import). Sin un trigger de broadcast, un aviso reactivo no tiene nada a lo que reaccionar; además `Swipe` ya re-fetchea el deck al montar y en cada `softReset`. Por eso NO se implementa el aviso ni un botón "recargar deck" en `Watchlists` en este plan. Si más adelante se agrega el broadcast, ahí entra el aviso.
- **Contadores "del último sync" al entrar a Watchlists:** no hay endpoint de lectura de conteos; los contadores se muestran a partir de la respuesta del refresh. Mostrar conteos persistidos al entrar sería un `GET /watchlists` adicional (YAGNI por ahora).

---

## Self-Review

- **Cobertura del spec:** modelo de datos → Task 1; `letterboxd.ts`/`scrapeWatchlist` → Tasks 2-3; endpoint `/watchlists/refresh` + replace-on-success → Tasks 5-6; `/deck` persistente → Task 6; pantalla Watchlists + routing + accesos → Tasks 7-8; quitar import (UI y backend) → Tasks 6-7. Deferrals del spec (broadcast, aviso, contadores persistidos) documentados arriba.
- **Consistencia de tipos:** `ScrapedFilm`, `RefreshResult`, `getUsersWithLetterboxd`, `refreshWatchlistForUser`, `refreshAllWatchlists`, `Watchlists({ onDone })`, `Swipe({ onWatchlists })` usados con las mismas firmas entre tasks productoras y consumidoras.
- **Sin placeholders:** cada step de código trae el código completo y cada test su comando + resultado esperado.
```
