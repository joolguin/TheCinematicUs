# Undo de swipe + contador de cards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deshacer el último swipe (un nivel, borra el swipe y el match si lo rompe) y mostrar cuántas cards quedan en el mazo.

**Architecture:** Backend: `undoSwipe` en `match.ts` (borra el swipe + reconcilia el match a la inversa) y un endpoint `POST /swipe/undo`. Frontend: estado `lastSwiped`, botón ↩ Deshacer que re-inserta la card y llama al backend, más un contador `deck.length`.

**Tech Stack:** Node 24 (alpine), TypeScript ESM, Express, `@supabase/supabase-js`, vitest (backend). React 19 + Vite (frontend, sin runner).

## Global Constraints

- **Todo corre en Docker. Nunca `npm`/`node` en el host.** Desde la raíz `/Users/jo/Documents/TheCinematicUs`:
  - backend suite: `docker compose run --rm --workdir /app/backend backend npm test`
  - backend 1 file: `docker compose run --rm --workdir /app/backend backend npx vitest run src/<archivo>.test.ts`
  - backend build: `docker compose run --rm --workdir /app/backend backend npm run build`
  - frontend typecheck: `docker compose run --rm --workdir /app/frontend frontend npx tsc -b`
  - frontend build: `docker compose run --rm --workdir /app/frontend frontend npm run build`
- **ESM:** imports internos con extensión `.js` (backend).
- **Commits normales por tarea, mensaje en español, estilo repo. NO trailer `Co-Authored-By: Claude`.**
- **Undo single-level:** solo el último swipe. `undoSwipe` es uniforme para pass y like (si era pass, el borrado del match es no-op).
- **No se revierte `user_movie_state`** en el undo (decisión de alcance).

---

### Task 1: Backend — `undoSwipe` + endpoint `POST /swipe/undo`

**Files:**
- Modify: `backend/src/match.ts` (agregar `undoSwipe`)
- Create: `backend/src/match.undo.test.ts`
- Modify: `backend/src/index.ts` (endpoint `POST /swipe/undo`)

**Interfaces:**
- Consumes: `supabase` de `./db.js`; `getUserByName` de `./users.js`; `getActiveSession` de `./sessions.js`.
- Produces: `undoSwipe(sessionId: string, userId: string, movieId: string): Promise<void>`; HTTP `POST /swipe/undo` body `{ user, movieId }` → `{ ok: true }`.

- [ ] **Step 1: Escribir el test que falla**

Create `backend/src/match.undo.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let likers: { user_id: string }[];
const swipeDeleteMock = vi.fn();
const matchDeleteMock = vi.fn();

vi.mock('./db.js', () => {
  // chain encadenable y awaitable: .eq() devuelve el mismo objeto; await → resolved.
  const eqChain = (resolved: any) => {
    const obj: any = { eq: () => obj, then: (r: any) => Promise.resolve(resolved).then(r) };
    return obj;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === 'swipes') {
          return {
            delete: () => { swipeDeleteMock(); return eqChain({ error: null }); },
            select: () => eqChain({ data: likers }),
          };
        }
        // matches
        return { delete: () => { matchDeleteMock(); return eqChain({ error: null }); } };
      },
    },
  };
});

import { undoSwipe } from './match.js';

beforeEach(() => {
  likers = [];
  swipeDeleteMock.mockClear();
  matchDeleteMock.mockClear();
});

describe('undoSwipe', () => {
  it('borra el swipe de la usuaria para esa peli', async () => {
    likers = [];
    await undoSwipe('s', 'jo', 'm1');
    expect(swipeDeleteMock).toHaveBeenCalledTimes(1);
  });

  it('borra el match si quedan menos de 2 likers distintos', async () => {
    likers = [{ user_id: 'vale' }]; // tras deshacer el like de Jo, solo queda Vale
    await undoSwipe('s', 'jo', 'm1');
    expect(matchDeleteMock).toHaveBeenCalledTimes(1);
  });

  it('no borra el match si siguen 2 likers distintos', async () => {
    likers = [{ user_id: 'vale' }, { user_id: 'otra' }];
    await undoSwipe('s', 'jo', 'm1');
    expect(matchDeleteMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `docker compose run --rm --workdir /app/backend backend npx vitest run src/match.undo.test.ts`
Expected: FAIL — `undoSwipe` no está exportada en `./match.js`.

- [ ] **Step 3: Implementar `undoSwipe` en `match.ts`**

En `backend/src/match.ts`, agregar al final del archivo:

```ts
// Deshace el último swipe: borra la fila de swipes y, si esa peli ya no tiene 2
// likers distintos en la sesión, borra el match (no dejar match fantasma por un
// like accidental). Uniforme para pass y like: si era pass, el borrado del match
// es no-op.
export async function undoSwipe(
  sessionId: string, userId: string, movieId: string,
): Promise<void> {
  await supabase.from('swipes').delete()
    .eq('session_id', sessionId).eq('user_id', userId).eq('movie_id', movieId);

  const { data: likers } = await supabase.from('swipes').select('user_id')
    .eq('session_id', sessionId).eq('movie_id', movieId).eq('liked', true);
  const distinct = new Set((likers ?? []).map((l: { user_id: string }) => l.user_id));
  if (distinct.size < 2) {
    await supabase.from('matches').delete()
      .eq('session_id', sessionId).eq('movie_id', movieId);
  }
}
```

- [ ] **Step 4: Correr y verificar verde**

Run: `docker compose run --rm --workdir /app/backend backend npx vitest run src/match.undo.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Agregar el endpoint `POST /swipe/undo` en `index.ts`**

En `backend/src/index.ts`, en el import de `./match.js` sumar `undoSwipe`:

```ts
import { recordSwipeAndDetectMatch, reconcileMatches, undoSwipe } from './match.js';
```

(Si el import actual no incluye exactamente esos nombres, agregá `undoSwipe` a la lista existente del import de `./match.js`.)

Y agregar el handler justo después del handler `app.post('/swipe', ...)`:

```ts
// Deshace el último swipe (single-level): borra el swipe y, si rompe la
// mutualidad, el match. user_movie_state no se revierte (es solo pista de orden).
app.post('/swipe/undo', async (req, res) => {
  try {
    const { user, movieId } = req.body as { user: string; movieId: string };
    const { id: userId } = await getUserByName(user);
    const { id: sessionId } = await getActiveSession();
    await undoSwipe(sessionId, userId, movieId);
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[error endpoint]', e);
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 6: Build + suite**

Run: `docker compose run --rm --workdir /app/backend backend npm run build`
Run: `docker compose run --rm --workdir /app/backend backend npm test`
Expected: `tsc` limpio + PASS (incluye los 3 nuevos de undo, sin regresión).

- [ ] **Step 7: Commit**

```bash
git add backend/src/match.ts backend/src/match.undo.test.ts backend/src/index.ts
git commit -m "feat(backend): undoSwipe + POST /swipe/undo (deshace swipe y reconcilia match)"
```

---

### Task 2: Frontend — contador + botón de undo (`Swipe.tsx`)

**Files:**
- Modify: `frontend/src/screens/Swipe.tsx`

**Interfaces:**
- Consumes: `api.post('/swipe/undo', { user, movieId })` (Task 1).

- [ ] **Step 1: Estado `lastSwiped`**

En `frontend/src/screens/Swipe.tsx`, junto a los demás `useState`, agregar:

```ts
  const [lastSwiped, setLastSwiped] = useState<Movie | null>(null);
```

- [ ] **Step 2: Guardar la peli swipeada en `swipe()`**

En la función `swipe(liked)`, después de `setDeck((d) => d.slice(1));` agregar:

```ts
    setLastSwiped(movie);
```

(`movie` ya es `const movie = top;` al inicio de `swipe`.)

- [ ] **Step 3: Handler `undo()`**

Agregar (cerca de `swipe`, dentro del componente):

```ts
  async function undo() {
    if (!lastSwiped) return;
    const movie = lastSwiped;
    setLastSwiped(null);
    setDeck((d) => [movie, ...d]);
    x.set(0);
    await api.post('/swipe/undo', { user, movieId: movie.id });
  }
```

- [ ] **Step 4: Limpiar `lastSwiped` en `softReset`**

En `softReset`, agregar (junto a los otros `set...` del reset, p.ej. después de `setChosen(null);`):

```ts
    setLastSwiped(null);
```

- [ ] **Step 5: Contador arriba del mazo**

Justo después de `<FilterBar genres={genres} filters={filters} onChange={applyLocalFilter} />` y antes del `<div className="flex-1 relative">`, agregar:

```tsx
      {deckLoaded && deck.length > 0 && (
        <div className="text-center text-xs text-neutral-500 pb-1">
          {deck.length} {deck.length === 1 ? 'peli' : 'pelis'} por ver
        </div>
      )}
```

- [ ] **Step 6: Botón ↩ Deshacer**

Justo antes del bloque de botones de swipe (`{top && !resetting && (` con la fila `flex justify-center gap-8 py-4`), agregar:

```tsx
      {lastSwiped && !resetting && (
        <div className="flex justify-center pb-2">
          <button onClick={undo} className="text-sm text-neutral-400 underline">↩ Deshacer</button>
        </div>
      )}
```

(Se renderiza aunque el mazo esté vacío: se puede deshacer el swipe que vació el mazo.)

- [ ] **Step 7: Typecheck + build**

Run: `docker compose run --rm --workdir /app/frontend frontend npx tsc -b`
Run: `docker compose run --rm --workdir /app/frontend frontend npm run build`
Expected: `tsc` sin errores + build OK.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/screens/Swipe.tsx
git commit -m "feat(frontend): contador de cards + botón de deshacer último swipe"
```

---

## Verificación manual (app levantada)
1. Swipear: el contador "X pelis por ver" baja en 1 por swipe.
2. Tocar ↩ Deshacer: la última card vuelve arriba del mazo, el contador sube en 1.
3. Deshacer un like que había matcheado: el match desaparece de la lista de matches (el contador del header se reconcilia al abrir la lista / nueva sesión).
4. Swipear dos veces seguidas: Deshacer solo recupera la última (single-level).
5. Nueva sesión: el botón Deshacer desaparece.

## Fuera de alcance (anotado)
- Multi-level undo, revertir `user_movie_state`, decremento en vivo del contador de matches.
