# Novedad desde la watchlist (`first_seen_at`) — Diseño

> Spec para el Milestone 5. Cierra el motor de novedad: las películas recién
> agregadas a una watchlist aparecen primero. Continúa M4 (`user_movie_state`).

## 1. Objetivo y contexto

M4 ordena el mazo por novedad usando el estado de swipes (nunca-vistas primero).
Falta la otra mitad de §3.1/§3.2: distinguir las pelis **recién agregadas a la
watchlist** de las que llevan meses estancadas, para mostrarlas primero.

El problema hoy: `refreshWatchlistForUser` hace **delete-all + insert** del set de
cada usuaria, así que cualquier noción de "desde cuándo está" se pierde en cada
refresh. Sin historia, no hay señal de novedad.

Cambios:
- Columna **`first_seen_at`** en `watchlist_items`.
- **Refresh diff-based**: preservar `first_seen_at` de las pelis que siguen,
  marcar las nuevas con `now`, borrar las que ya no están — manteniendo la
  guardia de umbral (M1).
- Extender **`orderByNovelty`**: dentro del bucket "nunca-vistas", las de
  `first_seen_at` más reciente van primero.

Decisión acordada: **no** se agrega `last_seen_at`. Como el refresh **borra** las
pelis que dejaron la watchlist, toda fila existente está en la watchlist ahora →
`last_seen_at` sería siempre ≈ now → redundante. Solo `first_seen_at` aporta.

## 2. Modelo de datos

```sql
alter table watchlist_items add column first_seen_at timestamptz not null default now();
```

Las filas existentes backfillean a `now()` por el default (todas parejas; recién
la próxima adición real queda con timestamp más nuevo). En `watchlist_items`
nuevas, el `create table` de cabecera incluye la columna.

## 3. Refresh diff-based (`refreshWatchlistForUser`)

Reescribir el reemplazo, preservando todo lo demás (guardia de umbral,
replace-on-success, manejo de errores):

1. Leer el set actual (igual que hoy: `select('movie_id').eq('user_id', userId)`).
   No hace falta `first_seen_at` acá: las filas que siguen **no se tocan**, así
   que su `first_seen_at` se preserva en la DB sin leerlo.
2. **Guardia de umbral (sin cambios):** si el set nuevo eliminaría
   > `MAX_REMOVAL_RATIO` (0.4) del set anterior no vacío → `{ ok:false, kept:true }`.
3. Diff contra el set previo:
   - `toInsert` = ids del scrape que **no** estaban → `insert` con
     `first_seen_at = now`.
   - **Que siguen** (intersección) → no se tocan (preservan su `first_seen_at`).
   - `toDelete` = ids previos que **ya no están** → `delete` por `(user_id, in(movie_id))`.
4. `count` = total del set nuevo (`uniqueIds.length`), igual que hoy.

```ts
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

(El bloque de lectura del set actual ya existe para la guardia de umbral y no
cambia. `first_seen_at` se preserva **no tocando** las filas que siguen.)

Nota: si el scrape viene degradado pero dentro del umbral, alguna peli podría
borrarse de más; la guardia de >40% acota el daño y es el contrato actual.

## 4. Orden — extender `orderByNovelty`

Tercer parámetro `firstSeen: Map<movieId, string>` (timestamp ISO). Dentro del
bucket "nunca-vistas" (sin `user_movie_state`), ordenar por `first_seen_at`
descendente (recién agregadas primero). El resto del orden (vistas por
`last_passed_at`/`pass_count`) queda igual que M4.

```ts
export function orderByNovelty<T extends { id: string }>(
  movies: T[], states: Map<string, MovieState>, firstSeen: Map<string, string>,
): T[] {
  return [...movies].sort((a, b) => {
    const sa = states.get(a.id);
    const sb = states.get(b.id);
    const seenA = sa ? 1 : 0;
    const seenB = sb ? 1 : 0;
    if (seenA !== seenB) return seenA - seenB;       // nunca-vistas primero
    if (seenA === 0) {                                // ambas nunca-vistas
      const fa = firstSeen.get(a.id) ? Date.parse(firstSeen.get(a.id)!) : 0;
      const fb = firstSeen.get(b.id) ? Date.parse(firstSeen.get(b.id)!) : 0;
      return fb - fa;                                 // recién agregada primero
    }
    const pa = sa?.last_passed_at ? Date.parse(sa.last_passed_at) : 0;
    const pb = sb?.last_passed_at ? Date.parse(sb.last_passed_at) : 0;
    if (pa !== pb) return pa - pb;
    return (sa?.pass_count ?? 0) - (sb?.pass_count ?? 0);
  });
}
```

Compatibilidad: los tests M4 de `orderByNovelty` pasan un `firstSeen` vacío
(`new Map()`) y mantienen sus expectativas (con firstSeen vacío, las nunca-vistas
quedan en empate → orden de entrada estable, idéntico a M4).

## 5. `/deck` — armar el mapa `firstSeen`

`/deck` ya carga `watchlist_items` para la unión. Cambiar el `select` a
`('movie_id, first_seen_at')` y construir `firstSeen` por peli como el **máximo**
`first_seen_at` entre sus filas (recién agregada por *cualquiera* de las dos →
cuenta como nueva). Las cadenas ISO comparan cronológicamente, así que el max es
una comparación de strings.

```ts
const { data: items } = await supabase
  .from('watchlist_items').select('movie_id, first_seen_at');
const firstSeen = new Map<string, string>();
for (const it of (items ?? []) as { movie_id: string; first_seen_at: string }[]) {
  const cur = firstSeen.get(it.movie_id);
  if (!cur || it.first_seen_at > cur) firstSeen.set(it.movie_id, it.first_seen_at);
}
const movieIds = [...firstSeen.keys()];
// ... (pending/swiped/movies igual que hoy) ...
const filtered = applyFilters(pool, filters);
const states = await getMovieStates(userId, filtered.map((m) => m.id));
res.json({ deck: orderByNovelty(filtered, states, firstSeen), genres: collectGenres(pool), filters });
```

(`movieIds` se deriva de `firstSeen.keys()`, que es la misma unión de
`movie_id` que hoy.)

## 6. Testing

**Backend (vitest):**
- `userMovieState.test.ts` (`orderByNovelty`):
  - Tests M4 existentes: agregar `new Map()` como tercer arg; expectativas
    intactas.
  - Nuevo: entre nunca-vistas, `first_seen_at` más reciente primero; una vista
    nunca pasa adelante de una nunca-vista por más nueva que sea la vista
    (el bucket manda).
- `watchlists.test.ts` (`refreshWatchlistForUser`, reescritura del mock para el
  diff):
  - Primer load (set previo vacío): inserta todas con `first_seen_at`, no borra.
  - Refresh con altas y bajas: inserta solo las nuevas (con `first_seen_at=now`),
    **no** re-inserta las que siguen, borra solo las que faltan.
  - Guardia de umbral: >40% se irían → mantiene el set, no inserta ni borra.
  - Errores de delete/insert → `{ ok:false, error }`.
- `/deck` no tiene tests unitarios; el armado del mapa `firstSeen` + el orden se
  validan con `tsc` (build) + prueba manual.

**Frontend:** nada (el deck llega ordenado).

## 7. Fuera de alcance
- `last_seen_at`, `watchlist_history`, eventos de "removida".
- Hard cooldown, contador de cards.
- Aplicar el DDL en Supabase (lo hace el humano).

## 8. Resumen de archivos tocados
- `backend/db/schema.sql` — `watchlist_items.first_seen_at` (header + migración idempotente).
- `backend/src/watchlists.ts` — `refreshWatchlistForUser` diff-based.
- `backend/src/watchlists.test.ts` — tests del diff.
- `backend/src/userMovieState.ts` — `orderByNovelty` con `firstSeen`.
- `backend/src/userMovieState.test.ts` — tests del orden por novedad de watchlist.
- `backend/src/index.ts` — `/deck` arma `firstSeen` y lo pasa a `orderByNovelty`.
