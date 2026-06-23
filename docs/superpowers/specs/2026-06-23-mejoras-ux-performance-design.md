# Mejoras de UX y performance — Diseño

Fecha: 2026-06-23
Estado: aprobado

## Contexto

Tras cerrar el bloque crítico (sesiones, carrera, match perdido), quedan mejoras de
UX y performance identificadas en la crítica y en el review final. Esta tanda las
agrupa en un solo spec. **El diseño visual del frontend se prototipa aparte (Claude
design) y se implementará después**; acá la UI se deja funcional y mínima — el foco es
comportamiento, estado y datos, no estética.

## Alcance (decidido con la usuaria)

Entra:
1. Persistir la usuaria entre recargas.
2. Presencia con estados ricos (en línea / swipeando / terminó su mazo).
3. Code-splitting del bundle.
4. Cosmético: `<title>` + favicon.
5. Minors backend: `reconcileMatches` en paralelo; reintento en `createSession`.

No entra (descartado explícitamente):
- **"Matches vistos" cross-dispositivo:** se queda en localStorage. Para una pareja que
  usa sus mismos teléfonos el bleed casi no ocurre; mover a la BD no compensa el costo.
- **`/matches` reconcilia en cada GET:** se deja como está. Es un backstop deliberado;
  "optimizarlo" baja robustez.

No hay cambios de esquema en la base de datos.

## Principio que se mantiene

**Privacidad de likes.** La presencia expone *actividad* (conectada, swipeando,
terminó), nunca *qué* likeó. No filtra preferencias. El frontend sigue sin leer
`swipes`/`watchlist_items`.

---

## 1. Persistir la usuaria

**Problema:** al recargar, la passphrase persiste pero no quién soy → vuelves a
"¿Quién soy?" e Importar, aunque el mazo siga intacto.

**Solución:** guardar la usuaria elegida en `localStorage['user']`.

- `App.tsx` decide la pantalla inicial:
  - sin passphrase → `gate`
  - con passphrase y sin `user` guardada → `user`
  - con passphrase y `user` guardada → `swipe` (directo)
- `UserSelect` guarda en localStorage al elegir (además de setear el estado).
- `Swipe` recibe un callback `onSwitch` y muestra en el header un control de texto
  **"cambiar"**: limpia `localStorage['user']` y vuelve a la pantalla `user`. Volver a
  elegir pasa de nuevo por `Import`, lo que también da acceso a re-importar títulos.

**Interfaz:**
- `App` pasa `onSwitch: () => void` a `Swipe`.
- `UserSelect.onPick` sigue igual; el guardado en localStorage ocurre dentro de
  `UserSelect` o en el handler de `App` (en `App`, para mantener `UserSelect` tonto).

Decisión: el guardado va en el `onPick` de `App` (`UserSelect` queda sin estado).

---

## 2. Presencia con estados ricos

**Problema:** no sabes si la otra entró, está swipeando o terminó. El mensaje "La otra
sigue eligiendo" lo asume.

**Solución:** canal Supabase Realtime **Presence**. Cada cliente montado en `Swipe`
publica su estado; cada cliente lee el de la otra y lo muestra.

**Estados** (`PresenceStatus`): `'en-linea' | 'swipeando' | 'termino'`.
- Al entrar a `Swipe` y antes de que cargue el deck → `'en-linea'`.
- Deck cargado con ≥1 carta → `'swipeando'`.
- Deck vacío (terminó) → `'termino'`.

**Mecánica:**
- Un canal `supabase.channel('presence', { config: { presence: { key: <user> } } })`.
- `channel.on('presence', { event: 'sync' }, ...)` recalcula el estado de la otra.
- `channel.track({ user, status })` al suscribir y cada vez que cambia el status.
- Al desmontar, `removeChannel` (la salida limpia el track → la otra ve "desconectada").

**Componente `PresenceBadge`** (nuevo, `frontend/src/components/PresenceBadge.tsx`):
- Props: `me: UserName`, `deckCount: number` (para derivar mi status) o, más simple,
  recibe `myStatus` ya derivado y un `otherStatus`. Decisión: el badge encapsula el
  canal Presence completo y recibe sólo `me: UserName` y `myStatus: PresenceStatus`;
  internamente trackea su estado y renderiza el de la otra.
- Render del estado de la otra: punto + texto.
  - `'en-linea'` → "en línea"
  - `'swipeando'` → "swipeando"
  - `'termino'` → "terminó su mazo"
  - ausente → "desconectada"
- Estilo mínimo (un punto de color + texto chico); sin pulir — el diseño llega después.

**Derivación de `myStatus` en `Swipe`:** `Swipe` ya conoce el deck. Calcula
`myStatus`: si el deck aún no se ha pedido/respondido → `'en-linea'`; si `deck.length > 0`
→ `'swipeando'`; si el deck cargó y quedó vacío → `'termino'`. Pasa `myStatus` al badge.

Para distinguir "deck no cargado aún" de "deck vacío", `Swipe` usa un flag
`deckLoaded: boolean` que pasa a `true` cuando `/deck` responde.

**Privacidad:** el payload de presence es `{ user, status }`. Sin información de pelis
ni likes.

---

## 3. Code-splitting

**Problema:** el bundle supera 500 kB → warning de Vite, primer paint más pesado.

**Solución (dos partes, en `frontend/`):**
- `vite.config.ts`: `build.rollupOptions.output.manualChunks` separando vendor en
  chunks propios: `react`/`react-dom`, `framer-motion`, `@supabase/supabase-js`. Mejora
  cacheo (el vendor no cambia entre deploys de la app).
- `MatchesList` se carga con `React.lazy` + `Suspense`, ya que sólo se monta al abrir el
  modal de ❤️ (no se necesita en el primer paint).

Criterio de éxito: el build ya no emite el warning de chunk >500 kB, o el chunk de la
app (sin vendor) queda claramente bajo el límite. Si la versión de Vite/rolldown no
acepta `manualChunks`, usar el equivalente que documente el propio warning del build
(`build.rolldownOptions.output`) — el implementador verifica contra el build real.

---

## 4. Cosmético: título y favicon

**Problema:** la pestaña dice "frontend"; no hay favicon propio.

**Solución (en `frontend/`):**
- `index.html`: `<title>TheCinematicU</title>`.
- `frontend/public/favicon.svg`: un SVG simple (monograma "TC" o un ícono de cine
  minimalista), referenciado desde `index.html` con
  `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`. Sin emoji. Placeholder
  funcional; se reemplazará cuando llegue el diseño.

---

## 5. Minors backend

**5a. `reconcileMatches` en paralelo** (`backend/src/match.ts`):
los upserts de match dejan de ser un loop secuencial y pasan a
`await Promise.all(matched.map((movieId) => supabase.from('matches').upsert(...)))`.
Comportamiento idéntico, sin esperas en cadena. El test existente de reconcile sigue
válido (verifica las llamadas de upsert, no su orden); ajustar el mock si el conteo de
llamadas se evalúa de forma sensible al orden.

**5b. Reintento en `createSession`** (`backend/src/sessions.ts`):
en el branch de conflicto `23505`, si la relectura de la sesión activa no devuelve
fila, reintentar la lectura una vez (otra transacción pudo no estar visible aún) antes
de lanzar el error. Si el reintento tampoco encuentra activa, recién ahí lanzar.

---

## Componentes y archivos

Frontend:
- `frontend/src/App.tsx` — pantalla inicial según `localStorage['user']`; guarda al
  elegir; pasa `onSwitch` a `Swipe`.
- `frontend/src/screens/UserSelect.tsx` — sin cambios de lógica (sigue tonto).
- `frontend/src/screens/Swipe.tsx` — control "cambiar"; deriva `myStatus`/`deckLoaded`;
  monta `PresenceBadge`; `MatchesList` lazy.
- `frontend/src/components/PresenceBadge.tsx` — **nuevo**; canal Presence + render.
- `frontend/src/types.ts` — `export type PresenceStatus = 'en-linea' | 'swipeando' | 'termino'`.
- `frontend/vite.config.ts` — manualChunks.
- `frontend/index.html` — título + favicon link.
- `frontend/public/favicon.svg` — **nuevo**.

Backend:
- `backend/src/match.ts` — `reconcileMatches` en paralelo.
- `backend/src/sessions.ts` — reintento en `createSession`.

## Manejo de errores

- **Presence:** si el canal no conecta, el badge muestra "desconectada" (estado por
  defecto) y la app funciona igual. La presencia es informativa, nunca bloqueante.
- **Reintento en `createSession`:** acotado a un solo reintento; si falla, se lanza el
  error original `23505` (comportamiento actual).

## Testing

Backend (Vitest):
- `reconcileMatches`: los 4 tests existentes deben seguir pasando; verificar que el
  cambio a `Promise.all` no rompa el conteo de upserts.
- `createSession`: agregar un caso donde el primer re-read tras `23505` devuelve null y
  el reintento devuelve la fila ganadora → retorna esa; y un caso donde ambos devuelven
  null → lanza.

Frontend (sin suite; verificación por build + manual):
- `tsc -b` + `vite build` limpios, sin warning de chunk >500 kB.
- Manual con dos navegadores: el badge refleja en línea / swipeando / terminó /
  desconectada de la otra; persistir usuaria salta directo a `swipe` al recargar;
  "cambiar" vuelve a selección.
