# Motor de novedad — `user_movie_state` — Diseño

> Spec para el Milestone 4. Persiste el estado acumulado por usuaria cruzando
> sesiones y ordena el mazo por novedad, para romper el "loop de las mismas
> cards" noche tras noche (problema §2.1 de la propuesta).

## 1. Objetivo y contexto

Hoy `/deck` devuelve la unión de las watchlists menos lo swipeado **en la sesión
actual**, sin orden (orden de DB). Cada noche nueva resetea los swipes, así que
reaparecen primero las mismas pelis ya pasadas en noches anteriores.

Este cambio agrega estado **por usuaria que cruza sesiones** (`user_movie_state`)
y ordena el mazo por novedad: primero lo nunca visto, después lo pasado hace más
tiempo. Es **soft cooldown**: nada se esconde, solo se reordena (con catálogo
chico, esconder vaciaría el mazo).

Decisiones de producto (ya acordadas):
- **Soft cooldown** (reordenar, nunca esconder).
- **Solo `user_movie_state`** en este milestone. Se **difiere** `first_seen_at`
  / novedad-desde-la-watchlist (§3.2), que requiere reescribir el refresh.
- `last_passed_at` null (peli solo-likeada, nunca pasada) cuenta como **alta
  prioridad** (época 0) — sin casos especiales, lo más simple.

## 2. Tabla `user_movie_state`

```sql
create table user_movie_state (
  user_id uuid not null references users(id),
  movie_id uuid not null references movies(id),
  pass_count int not null default 0,
  last_passed_at timestamptz,
  last_liked_at timestamptz,
  primary key (user_id, movie_id)
);
```

**Privacidad:** revela qué pasó/likeó cada usuaria → privado, igual que `swipes`
y `watchlist_items`. RLS + policy **DENY explícita** para anon. **No** va a la
publicación de Realtime (el frontend nunca la lee). Se extiende el test de
privacidad anon para cubrirla.

```sql
alter table user_movie_state enable row level security;
create policy "anon no lee user_movie_state" on user_movie_state for select to anon using (false);
```

## 3. Backend — módulo `userMovieState.ts`

Módulo nuevo `backend/src/userMovieState.ts` con tres unidades.

### 3.1 `recordMovieState(userId, movieId, liked): Promise<void>`
Read-modify-write (sin RPC; la concurrencia real es nula — una sola card a la
vez). Lee la fila actual, computa la nueva y hace `upsert`:
- **pass** (`liked=false`): `pass_count + 1`, `last_passed_at = now`, **preserva**
  `last_liked_at`.
- **like** (`liked=true`): `last_liked_at = now`, **preserva** `pass_count` y
  `last_passed_at`.

```ts
export interface MovieState {
  pass_count: number;
  last_passed_at: string | null;
  last_liked_at: string | null;
}

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
```

### 3.2 `getMovieStates(userId, movieIds): Promise<Map<string, MovieState>>`
Carga el estado de la usuaria para un set de pelis (las del deck filtrado).

```ts
export async function getMovieStates(
  userId: string, movieIds: string[],
): Promise<Map<string, MovieState>> {
  if (movieIds.length === 0) return new Map();
  const { data } = await supabase
    .from('user_movie_state')
    .select('movie_id, pass_count, last_passed_at, last_liked_at')
    .eq('user_id', userId).in('movie_id', movieIds);
  const map = new Map<string, MovieState>();
  for (const r of data ?? []) {
    map.set(r.movie_id, {
      pass_count: r.pass_count,
      last_passed_at: r.last_passed_at,
      last_liked_at: r.last_liked_at,
    });
  }
  return map;
}
```

### 3.3 `orderByNovelty(movies, states): T[]` — pura
El grueso del riesgo; ordena el deck:
1. **Nunca vista** (sin fila de estado) primero.
2. Entre las vistas: `last_passed_at` ascendente; null → época 0 (más antiguo /
   alta prioridad).
3. Desempate: `pass_count` ascendente.
Empates totales preservan el orden de entrada (sort estable de JS).

```ts
export function orderByNovelty<T extends { id: string }>(
  movies: T[], states: Map<string, MovieState>,
): T[] {
  return [...movies].sort((a, b) => {
    const sa = states.get(a.id);
    const sb = states.get(b.id);
    const seenA = sa ? 1 : 0;
    const seenB = sb ? 1 : 0;
    if (seenA !== seenB) return seenA - seenB;          // nunca-vistas primero
    const pa = sa?.last_passed_at ? Date.parse(sa.last_passed_at) : 0;
    const pb = sb?.last_passed_at ? Date.parse(sb.last_passed_at) : 0;
    if (pa !== pb) return pa - pb;                       // pasada hace más tiempo primero
    return (sa?.pass_count ?? 0) - (sb?.pass_count ?? 0); // menos pasadas primero
  });
}
```

## 4. Backend — cableado en endpoints

### 4.1 `POST /swipe` (en `index.ts`)
Después de `recordSwipeAndDetectMatch`, registrar el estado acumulado:
```ts
const result = await recordSwipeAndDetectMatch(sessionId, userId, movieId, liked);
await recordMovieState(userId, movieId, liked);
if (liked) await reconcileMatches(sessionId);
res.json(result);
```
`match.ts` queda enfocado en matching; el estado de novedad lo orquesta el
endpoint. (`recordSwipeAndDetectMatch` no cambia.)

### 4.2 `GET /deck` (en `index.ts`)
Tras filtrar, cargar el estado y ordenar:
```ts
const filtered = applyFilters(pool, filters);
const states = await getMovieStates(userId, filtered.map((m) => m.id));
const deck = orderByNovelty(filtered, states);
res.json({ deck, genres: collectGenres(pool), filters });
```
(`genres` se sigue calculando del `pool` sin filtrar, como hoy.)

## 5. Privacidad — extender el test

En `backend/src/privacy.integration.test.ts`, agregar un caso que la anon key
**no** puede leer `user_movie_state` (devuelve 0 filas), igual que `swipes` y
`watchlist_items`.

## 6. Testing

**Backend (vitest):**
- `userMovieState.test.ts`:
  - `orderByNovelty` (puro, el grueso): nunca-vistas primero; entre vistas, menor
    `last_passed_at` primero; `last_passed_at` null = alta prioridad; desempate
    por `pass_count`; sin estados → preserva orden de entrada; pool vacío → `[]`.
  - `recordMovieState`: pass incrementa `pass_count` + setea `last_passed_at`,
    preserva `last_liked_at`; like setea `last_liked_at`, preserva `pass_count` y
    `last_passed_at`; fila nueva (sin existing) arranca de `0`/now correctos.
  - `getMovieStates`: arma el Map desde las filas; `movieIds` vacío → Map vacío.
- `/deck` y `/swipe` no tienen tests unitarios (sin `index.test.ts`); se validan
  con `tsc` (build) + prueba manual.
- El test de privacidad anon suma `user_movie_state`.

**Frontend:** **nada**. El orden lo decide el backend; el deck ya llega ordenado.

## 7. Fuera de alcance
- `first_seen_at` / `last_seen_at` en `watchlist_items` y novedad-desde-la-watchlist
  (§3.2 — requiere reescribir `refreshWatchlistForUser` de wipe-and-insert a
  upsert + delete-missing).
- Hard cooldown (esconder por ventana).
- Contador de cards restantes.
- Limpiar `user_movie_state` de pelis que ya no están en `movies` (cascade
  futuro; a esta escala no urge).

## 8. Resumen de archivos tocados
- `backend/db/schema.sql` — tabla `user_movie_state` + RLS DENY (header + migración idempotente).
- `backend/src/userMovieState.ts` (nuevo) — `MovieState`, `recordMovieState`, `getMovieStates`, `orderByNovelty`.
- `backend/src/userMovieState.test.ts` (nuevo).
- `backend/src/index.ts` — `/swipe` registra estado; `/deck` ordena por novedad.
- `backend/src/privacy.integration.test.ts` — anon no lee `user_movie_state`.
