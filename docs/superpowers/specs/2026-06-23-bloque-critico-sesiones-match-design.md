# Bloque crítico: sesiones y match — Diseño

Fecha: 2026-06-23
Estado: aprobado

## Contexto

Crítica de funcionalidad sobre la Fase 1 ya desplegada (TheCinematicU). Tres hoyos
rompen el producto en uso real de pareja:

1. **"Nueva sesión" es global, destructiva y silenciosa.** Al tocar 🔄, una usuaria
   desactiva la sesión de ambas y resetea mazo + matches sin que la otra se entere.
   La otra sigue con su deck viejo en pantalla y sus swipes caen en la sesión nueva:
   estado fantasma.
2. **Carrera al crear sesión.** `getActiveSession()` auto-crea si no hay activa. Dos
   entradas casi simultáneas pueden dejar **dos sesiones activas**; los
   `watchlist_items` se reparten entre dos `session_id` y el deck queda incompleto.
3. **Match simultáneo perdido.** Si ambas likean la misma peli en el mismo instante,
   cada transacción puede leer los swipes de la otra antes de que existan → ninguna
   crea el match. Como el deck ya no las vuelve a mostrar, ese match se pierde para
   siempre. La robustez actual sólo re-encola matches que **ya existen** en la tabla.

Este spec ataca los tres. Fuera de alcance (mejoras no críticas, otro día):
`seenMatches` cross-dispositivo, presencia/online, persistir la usuaria al refrescar.

## Principios que se mantienen

- **Privacidad de likes:** el frontend nunca lee `swipes`/`watchlist_items`. Toda la
  lógica cruzada vive en el backend con service role. Nada de lo de acá afloja eso.
- **Match ocasional:** la sesión sigue siendo la noche; "Nueva sesión" sigue
  reseteando de cero. Sólo se vuelve coordinada, no silenciosa.

---

## Fix 2 — Una sola sesión activa (a nivel DB)

**Problema:** dos sesiones activas concurrentes.

**Solución:** índice único parcial en Postgres que hace imposible más de una sesión
activa simultánea:

```sql
create unique index if not exists one_active_session on sessions (active) where active;
```

Con el índice, `createSession()` puede correr en concurrencia sin dejar dos activas:

- `getActiveSession()` lee la activa; si existe la retorna; si no, llama a
  `createSession()`.
- `createSession()` desactiva las activas y luego inserta una nueva con `active=true`.
  Si dos llamadas concurrentes intentan insertar, el índice deja pasar **una sola**;
  la otra recibe violación de unicidad (código Postgres `23505`) → la captura y
  **re-lee** la activa que ganó, retornando esa. Nadie crea una segunda.

**Interfaz resultante (`backend/src/sessions.ts`):**

```ts
getActiveSession(): Promise<{ id: string }>
createSession(startedBy?: string): Promise<{ id: string }>
```

`startedBy` es el nombre de la usuaria que inició la noche (para el aviso del Fix 1);
opcional para no romper llamadas internas que no lo necesiten.

---

## Fix 3 — Reconciliación de matches

**Problema:** match mutuo sin fila en `matches` por carrera de lectura/escritura.

**Solución:** función backstop que, para una sesión, encuentra todas las pelis donde
**ambas** usuarias likearon pero **no** existe match, e inserta las que falten. El
`unique(session_id, movie_id)` ya existente la hace idempotente.

**Interfaz (`backend/src/match.ts`):**

```ts
reconcileMatches(sessionId: string): Promise<void>
```

Lógica: contar likes por `movie_id` en la sesión (`liked=true`); las pelis con likes
de **dos** usuarias distintas son matches; insertar las que no estén ya en `matches`
(insert idempotente, ignora conflicto). Implementable con queries de Supabase sin SQL
crudo: traer swipes likeados de la sesión, agrupar por `movie_id` contando user_ids
distintos, filtrar las que tengan 2, insertar.

**Dónde se llama:**

- Dentro de `recordSwipeAndDetectMatch`, después de la detección directa, cuando el
  swipe es un like. Así el segundo writer siempre cierra la ventana.
- En `GET /matches`, antes de leer, como red de seguridad adicional (barato).

No se llama en `/deck` (innecesario; `/swipe` y `/matches` ya cubren).

El INSERT tardío del match dispara Realtime → el overlay aparece en ambas pantallas
igual que un match normal. Sin polling.

---

## Fix 1 — Nueva sesión coordinada (reset + aviso en vivo)

**Problema:** reset silencioso deja a la otra con estado fantasma.

**Decisión de producto (aprobada):** reset automático para ambas, con aviso vía
Realtime. Sin handshake: la noche nueva arranca al toque, pero la otra se entera y su
pantalla se reacomoda sola.

**Cambios de datos:**

```sql
alter table sessions add column if not exists started_by text;
alter publication supabase_realtime add table sessions;
```

`sessions` queda legible por anon (ya tiene policy de SELECT) y publicada en Realtime.
No expone likes: una sesión sólo dice id, modo, activa, fecha y quién la inició.

**Backend:**

- `POST /session` lee `user` del body y lo pasa como `startedBy` a `createSession`.
- `GET /matches` incluye `sessionId` en la respuesta para que el frontend sepa cuál es
  la sesión actual (baseline de la suscripción y scoping de `seenMatches`).

Respuesta de `/matches`:

```json
{ "sessionId": "<uuid>", "matches": [ { "matchId": "<uuid>", "...campos de peli": "" } ] }
```

**Frontend (`Swipe.tsx`):**

- Al montar, guarda el `sessionId` actual (de `/matches`).
- Se suscribe a `INSERT` en `sessions` por Realtime. Cuando llega una fila con `id`
  distinto al `sessionId` guardado → es una noche nueva:
  1. Muestra aviso efímero: `🦆 Vale empezó una noche nueva` (o 🐭 Jo, según
     `started_by`; si soy yo quien la inició, no muestro aviso).
  2. Soft reset: refetch del deck, `matchCount` a 0, `chosen` a null, cierra overlays,
     actualiza el `sessionId` guardado.
  3. Limpia los matches vistos de la sesión vieja.
- "Nueva sesión" propia: en vez de `window.location.reload()`, hace el mismo soft reset
  localmente tras `POST /session` (el reload sigue funcionando, pero el soft reset es
  consistente con lo que ve la otra).

El aviso es un banner/toast simple (no bloquea), desaparece solo a los pocos segundos.

**`seenMatches` por sesión (`MatchOverlay.tsx`):**

Hoy `seenMatches` es una sola lista global en localStorage que crece para siempre y se
arrastra entre noches. Pasa a guardarse por sesión: clave `seenMatches:<sessionId>`.
El `MatchOverlay` obtiene el `sessionId` actual desde la respuesta de `/matches` (que
ya consume). Así cada noche parte limpia y no hay bleed entre sesiones.

---

## Migración

La DB ya está viva en Supabase con datos. El `schema.sql` se complementa con un bloque
**idempotente** al final (todo `if not exists` / `add column if not exists`) para
aplicar sin recrear tablas:

```sql
-- Migración bloque crítico (2026-06-23) — idempotente
create unique index if not exists one_active_session on sessions (active) where active;
alter table sessions add column if not exists started_by text;
alter publication supabase_realtime add table sessions;
```

Antes de crear el índice único, puede existir más de una sesión activa por la carrera
previa. El bloque de migración primero deja una sola activa:

```sql
update sessions set active = false
where active and id <> (
  select id from sessions where active order by created_at desc limit 1
);
```

(ejecutar ese `update` **antes** del `create unique index`).

---

## Manejo de errores

- **Conflicto de sesión (`23505`):** capturado en `createSession`, re-lee la activa.
  No se propaga como error al cliente.
- **`reconcileMatches` falla:** se loguea y no rompe el `/swipe` ni el `/matches`
  (la detección directa ya cubre el caso común; la reconciliación es backstop).
- **Realtime de `sessions` no llega:** el soft reset igual ocurre la próxima vez que la
  otra refresque o pida `/deck` (que ya lee la sesión activa). El aviso se pierde, el
  estado no.

## Testing

Backend (Vitest, como en Fase 1):

- `reconcileMatches`: ambas likean → crea match; sólo una → no crea; ya existe el
  match → no duplica (idempotente); pelis sin likes → no toca.
- `createSession`/`getActiveSession`: tras `createSession`, la anterior queda inactiva
  y hay exactamente una activa; el camino de conflicto re-lee en vez de duplicar.

Frontend: verificación manual del soft reset + aviso entre dos navegadores (las dos
usuarias), ya que es flujo Realtime end-to-end.

## Archivos que se tocan

- `backend/db/schema.sql` — índice parcial, `started_by`, publicar `sessions`; bloque
  de migración idempotente.
- `backend/src/sessions.ts` — single-active atómico + `startedBy`.
- `backend/src/match.ts` — `reconcileMatches()` + llamada en `recordSwipeAndDetectMatch`.
- `backend/src/index.ts` — `/session` con `user`; reconciliar y devolver `sessionId` en
  `/matches`.
- `frontend/src/screens/Swipe.tsx` — suscripción a `sessions`, soft reset + aviso.
- `frontend/src/components/MatchOverlay.tsx` — `seenMatches` por `sessionId`.
