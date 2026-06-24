# Filtros pre-sesión (compartidos) — Diseño

> Spec para el Milestone 2.1. Permite acotar el mazo de una noche por duración
> y géneros, con el filtro compartido entre las dos usuarias y sincronizado en vivo.

## 1. Objetivo y contexto

El mazo es la unión de las dos watchlists (~400 pelis). La mayoría de las
decisiones reales de una noche son contextuales ("algo corto", "sin terror").
Hoy no se puede acotar el deck pese a tener metadata rica de TMDB
(`runtime`, `genres`). Este cambio agrega un filtro **opcional**, **compartido
por sesión**, aplicado a la duración y a los géneros.

Decisiones de producto (ya acordadas):
- **Filtros:** duración máxima (`maxRuntime`) + géneros a excluir (`excludeGenres`).
  Sin streaming (no hay data de providers) y sin "incluir solo estos géneros"
  (uso más raro; fuera de alcance).
- **Alcance:** compartido. Hay **un solo filtro por noche**; cualquiera de las
  dos lo edita y aplica a las dos. Last-write-wins, sin merge.
- **Obligatoriedad:** opcional. Default = sin filtro = mazo completo.
- **Sync:** por Realtime sobre la fila de `sessions` (publicación ya existente).
- **Aviso:** cuando una cambia el filtro, la otra ve un aviso efímero
  ("X cambió el filtro"), reutilizando el patrón `aviso` de `Swipe.tsx`.

Propiedad emergente deseada: una **sesión nueva** (nueva noche) arranca sin
filtro automáticamente, porque es una fila nueva de `sessions` con `filters` en
default `null`. No hay que resetear nada a mano.

## 2. Decisión de arquitectura: filtrado en el backend

El filtro es **estado de la sesión** (fuente de verdad en la DB) y la
**aplicación ocurre en el backend**: `/deck` lee los filtros de la sesión activa
y devuelve el mazo ya filtrado.

Por qué backend y no client-side:
- El frontend **no tiene runner de tests**; la lógica de filtrado (la parte con
  riesgo de bug: nulls, exclusión) debe vivir donde hay tests (backend, vitest).
- El modelo compartido ya exige un round-trip al backend al cambiar el filtro
  (PATCH), así que "instant client-side" no era gratis igual.
- El deck es chico (~400); un refetch por cambio de filtro es trivial.

Costo aceptado: mover el slider hace un PATCH + refetch **debounced** (~400 ms
tras el último ajuste), no un re-filtrado en memoria. Imperceptible a esta escala.

## 3. Modelo de datos

Dos columnas nuevas en `sessions` (espejo del patrón `started_by`):

```sql
alter table sessions add column if not exists filters jsonb;            -- null = sin filtro
alter table sessions add column if not exists filters_updated_by text;  -- quién tocó el filtro (para el aviso)
```

Forma de `filters` cuando no es `null`:

```ts
interface SessionFilters {
  maxRuntime: number | null;   // minutos; null = sin límite de duración
  excludeGenres: string[];     // nombres de género a excluir; [] = sin exclusión
}
```

`null` (columna sin valor) y `{ maxRuntime: null, excludeGenres: [] }` son
ambos "sin efecto": el deck sale completo.

## 4. Predicado de filtrado (backend, puro y testeado)

Módulo nuevo `backend/src/filters.ts` con dos funciones puras:

```ts
export function applyFilters(movies: Movie[], filters: SessionFilters | null): Movie[]
export function collectGenres(movies: Movie[]): string[]  // unión ordenada y deduplicada de géneros del pool
```

`collectGenres` se extrae como función pura justamente para poder testear el
cálculo de `availableGenres` sin pasar por el endpoint.

Reglas (cada peli pasa si cumple TODAS):
- **Sin filtro:** `filters == null` → passthrough (devuelve `movies` tal cual).
- **maxRuntime:** pasa si `filters.maxRuntime == null` **o** `movie.runtime == null`
  (duración desconocida → no se esconde) **o** `movie.runtime <= filters.maxRuntime`.
- **excludeGenres:** pasa si `excludeGenres` está vacío **o** la peli no tiene
  ninguno de esos géneros. `movie.genres == null` → pasa (no se puede excluir lo
  que no se conoce).

`Movie` acá es la fila de `movies` (tiene `runtime: number|null`,
`genres: string[]|null`). El predicado no depende de Supabase: recibe arrays y
devuelve arrays, testeable en aislamiento.

## 5. Backend — endpoints

### 5.1 `GET /deck?user=X` (modificado)
Hoy devuelve `{ deck }`. Pasa a:
1. Resolver `userId` y la sesión activa (incluyendo `filters`).
2. Traer la unión de `watchlist_items` (pool) menos lo ya swipeado por la usuaria
   en la sesión (igual que hoy).
3. Cargar las pelis del pool desde `movies`.
4. Calcular `availableGenres`: unión ordenada de todos los géneros presentes en
   el pool **antes** de filtrar (para poblar los chips aunque el filtro activo
   los excluya).
5. Aplicar `applyFilters(poolMovies, session.filters)`.
6. Responder `{ deck, genres: availableGenres, filters: session.filters }`.

`filters` y `genres` van en la respuesta para que el cliente inicialice el
control y herede el filtro vigente si entra a mitad de noche.

### 5.2 `PATCH /session/filters` (nuevo)
Body: `{ user: string; filters: SessionFilters }`.
- Resuelve la sesión activa.
- `update sessions set filters = <filters>, filters_updated_by = <user> where id = <activa>`.
- Responde `{ ok: true }`.

Para "limpiar" el filtro, el cliente manda `{ maxRuntime: null, excludeGenres: [] }`
(equivalente a sin filtro; no hace falta soportar `null` explícito por el body).

`getActiveSession()` debe pasar a seleccionar también `filters` (hoy probablemente
solo trae `id`); revisar `sessions.ts`.

## 6. Frontend

### 6.1 Estado y carga (`Swipe.tsx`)
- Nuevo estado: `filters: SessionFilters | null`, `availableGenres: string[]`.
- `GET /deck` ahora setea `deck`, `filters` y `availableGenres` desde la respuesta.
- El deck llega **ya filtrado**; no se filtra en el cliente.

### 6.2 Control de filtros
Un panel/hoja plegable arriba del mazo (UI funcional, sin pulir):
- Slider de duración máxima (p.ej. 60–240 min, con opción "sin límite").
- Chips de géneros (de `availableGenres`) que se marcan para **excluir**.
- Al cambiar cualquier control: actualizar el estado local del control de
  inmediato (feedback visual) y **debouncear** (~400 ms) un
  `api.post('/session/filters', { user, filters })`; al resolver, refetch `/deck`.
  (Se usa `api.post`; el helper actual no tiene `patch`. Alternativa: agregar
  `patch` a `api`. El plan decide; `POST /session/filters` es aceptable y evita
  tocar el helper.)

> Nota de método HTTP: el spec nombra el endpoint `PATCH` semánticamente, pero
> el helper `api` solo tiene `get`/`post`. Implementarlo como **`POST
> /session/filters`** para no ampliar el helper. (Resolución de ambigüedad.)

### 6.3 Sync por Realtime
Extender `useSessionListener` (o un hook hermano `useSessionFilters`) para
suscribirse también a eventos **UPDATE** sobre `sessions`:
- Si `payload.new.id === sessionId` actual y `payload.new.filters_updated_by !== user`:
  - Actualizar `filters` local con `payload.new.filters` y **refetch `/deck`**.
  - Mostrar `aviso` efímero `"${payload.new.filters_updated_by} cambió el filtro"`
    (mismo patrón visual/timeout que "Empezó una noche nueva").
- El cliente que originó el cambio se reconoce por `filters_updated_by === user`
  y **no** muestra aviso ni doble-refetch (ya refetcheó tras su propio POST).

El hook hoy escucha solo `INSERT`. Agregar el handler `UPDATE` en la misma
suscripción/canal o en uno nuevo; mantener el comportamiento `INSERT` (nueva
noche) intacto.

## 7. Manejo de errores
- `POST /session/filters` sin sesión activa → 500 con mensaje (igual que los
  otros endpoints); el cliente ya hace `throw` en `!res.ok`. No se bloquea el
  swipe.
- Si el refetch de `/deck` falla tras un cambio de filtro, se mantiene el deck
  anterior (no romper la pantalla). El control refleja el último filtro local.
- `filters` malformado en la DB (no debería pasar): `applyFilters` trata
  cualquier `filters` con campos faltantes de forma defensiva (`maxRuntime`
  ausente = sin límite; `excludeGenres` ausente = `[]`).

## 8. Testing

**Backend (vitest, ya configurado):**
- `filters.test.ts` para `applyFilters` — el grueso del riesgo:
  - sin filtro (`null`) → passthrough.
  - `maxRuntime` excluye largas, mantiene cortas, **mantiene `runtime: null`**.
  - `excludeGenres` saca las que tienen un género excluido, **mantiene
    `genres: null`**, mantiene las que no lo tienen.
  - combinación runtime + género.
  - `excludeGenres: []` y `maxRuntime: null` → passthrough.
  - campos faltantes en `filters` → tratados como sin efecto.
- `collectGenres`: unión ordenada y deduplicada, ignora `genres: null`,
  pool vacío → `[]`.
- Los endpoints de `index.ts` **no tienen tests unitarios hoy** (no existe
  `index.test.ts`) y este alcance no los agrega. El wiring de `/deck` y
  `POST /session/filters` se valida con `tsc` (build) + prueba manual; la
  lógica con riesgo (filtrado y cálculo de géneros) queda cubierta por las
  funciones puras `applyFilters` / `collectGenres`.
- Si `getActiveSession` tiene tests en `sessions.test.ts`, actualizarlos para
  cubrir que ahora selecciona/devuelve `filters`.

**Frontend:** no hay runner; no se agregan tests de frontend en este alcance.
Toda la lógica con riesgo vive en el backend. El frontend se valida con
`tsc -b` (build) y prueba manual.

## 9. Fuera de alcance
- Streaming / disponibilidad por provider (requiere enrichment nuevo de TMDB).
- `includeGenres` ("solo estos géneros").
- Contador de cards restantes (el deck filtrado lo habilita; va aparte si se quiere).
- Tests de frontend / setup de runner de tests en el frontend.

## 10. Resumen de archivos tocados
- `backend/db/schema.sql` — columnas `filters`, `filters_updated_by` (header + migración idempotente).
- `backend/src/filters.ts` (nuevo) — `SessionFilters`, `applyFilters`, `collectGenres`.
- `backend/src/filters.test.ts` (nuevo) — cubre `applyFilters` y `collectGenres`.
- `backend/src/sessions.ts` — `getActiveSession` selecciona `filters` (+ tests en `sessions.test.ts` si aplica).
- `backend/src/index.ts` — `/deck` aplica filtros + devuelve `genres`/`filters`; nuevo `POST /session/filters`.
- `frontend/src/api.ts` — tipos `SessionFilters` (o en `types.ts`); deck response.
- `frontend/src/screens/Swipe.tsx` — estado de filtros, control, refetch, aviso.
- `frontend/src/hooks/useSessionListener.ts` — handler UPDATE para sync + aviso.
