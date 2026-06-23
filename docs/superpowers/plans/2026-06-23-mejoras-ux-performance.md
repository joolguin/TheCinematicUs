# Mejoras de UX y performance — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistir la usuaria, mostrar presencia en vivo con estados ricos, separar el bundle, y limpiar dos minors de backend — sin tocar el esquema de la BD ni aflojar la privacidad de likes.

**Architecture:** Casi todo es frontend (React + Vite + Supabase Realtime Presence). El backend solo recibe dos retoques (`match.ts`, `sessions.ts`) con sus tests. La presencia usa un canal Realtime Presence efímero que publica `{ user, status }` — actividad, nunca likes.

**Tech Stack:** React + Vite + TS + framer-motion + Supabase Realtime (frontend); Node + Express + TS + Vitest (backend); Docker Compose para todo.

## Global Constraints

- **Todo corre en Docker.** Nunca npm/node en el host. Tests backend: `docker compose run --rm backend npm --workspace backend test`. Build frontend: `docker compose run --rm frontend npm --workspace frontend run build`.
- **Commits sin trailer `Co-Authored-By: Claude`.**
- **Copy de UI en español neutro chileno** (tú, no voseo).
- **Privacidad de likes:** el frontend nunca lee `swipes`/`watchlist_items`. La presencia expone solo `{ user, status }`.
- **El diseño visual llega después** (se prototipa aparte). La UI nueva se deja funcional y mínima — sin pulir spacing/colores.
- **Sin cambios de esquema en la BD.**

---

### Task 1: Minors de backend

**Files:**
- Modify: `backend/src/match.ts` (reconcile en paralelo)
- Modify: `backend/src/sessions.ts` (reintento en el caso 23505)
- Test: `backend/src/sessions.test.ts` (agregar 2 casos + cola de lecturas en el mock)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: firmas sin cambios — `reconcileMatches(sessionId: string): Promise<void>`, `createSession(startedBy?: string): Promise<{ id: string }>`.

- [ ] **Step 1: Reemplazar el loop secuencial de `reconcileMatches` por `Promise.all`**

En `backend/src/match.ts`, reemplazar el bloque final `for (const movieId of matched) { await supabase... }` por:

```ts
  await Promise.all(
    matched.map((movieId) =>
      supabase.from('matches').upsert(
        { session_id: sessionId, movie_id: movieId },
        { onConflict: 'session_id,movie_id', ignoreDuplicates: true },
      ),
    ),
  );
```

- [ ] **Step 2: Verificar que los tests de reconcile siguen pasando**

Run: `docker compose run --rm backend npm --workspace backend test -- reconcile.test`
Expected: PASS (4 tests). El conteo de upserts no depende del orden.

- [ ] **Step 3: Escribir los tests de reintento (fallan)**

Reemplazar el contenido completo de `backend/src/sessions.test.ts` por:

```ts
// backend/src/sessions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let activeRow: any;        // lectura por defecto de la sesión activa
let activeReads: any[] | null; // si está seteado, se consume en orden (para probar reintentos)
let insertResult: any;     // { data, error } que devuelve el insert
const updateMock = vi.fn();
const insertMock = vi.fn();

// Devuelve la siguiente lectura de "sesión activa": consume la cola si existe,
// si no usa activeRow.
function readActive() {
  if (activeReads && activeReads.length) return { data: activeReads.shift() };
  return { data: activeRow };
}

vi.mock('./db.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve(readActive()) }) }) }),
      }),
      update: (...a: any[]) => { updateMock(...a); return { eq: () => Promise.resolve({ error: null }) }; },
      insert: (...a: any[]) => { insertMock(...a); return { select: () => ({ single: () => Promise.resolve(insertResult) }) }; },
    }),
  },
}));

import { getActiveSession, createSession } from './sessions.js';

beforeEach(() => {
  activeRow = null;
  activeReads = null;
  insertResult = { data: { id: 'nueva' }, error: null };
  updateMock.mockClear();
  insertMock.mockClear();
});

describe('getActiveSession', () => {
  it('devuelve la sesión activa si existe', async () => {
    activeRow = { id: 's1' };
    expect(await getActiveSession()).toEqual({ id: 's1' });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('crea una sesión si no hay activa', async () => {
    activeRow = null;
    insertResult = { data: { id: 's2' }, error: null };
    expect(await getActiveSession()).toEqual({ id: 's2' });
    expect(insertMock).toHaveBeenCalled();
  });
});

describe('createSession', () => {
  it('desactiva las activas y devuelve la nueva', async () => {
    insertResult = { data: { id: 's3' }, error: null };
    expect(await createSession()).toEqual({ id: 's3' });
    expect(updateMock).toHaveBeenCalledWith({ active: false });
  });

  it('guarda started_by', async () => {
    insertResult = { data: { id: 's4' }, error: null };
    await createSession('Vale');
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ started_by: 'Vale' }));
  });

  it('ante carrera (23505) re-lee la sesión activa ganadora', async () => {
    insertResult = { data: null, error: { code: '23505', message: 'duplicate' } };
    activeRow = { id: 'ganadora' };
    expect(await createSession()).toEqual({ id: 'ganadora' });
  });

  it('reintenta la lectura si la ganadora no es visible al primer intento', async () => {
    insertResult = { data: null, error: { code: '23505', message: 'duplicate' } };
    activeReads = [null, { id: 'ganadora' }]; // 1ra lectura vacía, 2da trae la ganadora
    expect(await createSession()).toEqual({ id: 'ganadora' });
  });

  it('lanza si tras reintentar no hay sesión activa', async () => {
    insertResult = { data: null, error: { code: '23505', message: 'duplicate' } };
    activeReads = [null, null];
    await expect(createSession()).rejects.toMatchObject({ code: '23505' });
  });
});
```

- [ ] **Step 4: Correr los tests para verificar que los 2 nuevos fallan**

Run: `docker compose run --rm backend npm --workspace backend test -- sessions.test`
Expected: FAIL en "reintenta la lectura..." (hoy solo lee una vez) y posiblemente en "lanza si tras reintentar...".

- [ ] **Step 5: Implementar el reintento en `createSession`**

En `backend/src/sessions.ts`, reemplazar el branch del error por:

```ts
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      // Otra llamada concurrente ganó la carrera. Re-leer la activa; reintentar una vez
      // si todavía no es visible.
      for (let intento = 0; intento < 2; intento++) {
        const { data: active } = await supabase
          .from('sessions').select('id').eq('active', true)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (active) return { id: active.id };
      }
    }
    throw error;
  }
```

- [ ] **Step 6: Correr toda la suite backend**

Run: `docker compose run --rm backend npm --workspace backend test`
Expected: PASS (todos los archivos; sessions.test ahora con 7 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/src/match.ts backend/src/sessions.ts backend/src/sessions.test.ts
git commit -m "perf(backend): reconcile en paralelo + reintento de lectura en createSession"
```

---

### Task 2: Cosmético — título y favicon

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/public/favicon.svg`

**Interfaces:** ninguna.

- [ ] **Step 1: Cambiar el `<title>`**

En `frontend/index.html`, reemplazar `<title>frontend</title>` por:

```html
    <title>TheCinematicU</title>
```

- [ ] **Step 2: Reemplazar el favicon por un monograma propio**

Reemplazar el contenido completo de `frontend/public/favicon.svg` por:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0a0a0a"/>
  <text x="32" y="43" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="700" fill="#f43f5e" text-anchor="middle">TC</text>
</svg>
```

- [ ] **Step 3: Verificar que el build pasa**

Run: `docker compose run --rm frontend npm --workspace frontend run build`
Expected: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html frontend/public/favicon.svg
git commit -m "chore(frontend): título TheCinematicU + favicon propio"
```

---

### Task 3: Code-splitting del bundle

**Files:**
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/src/screens/Swipe.tsx` (MatchesList con lazy + Suspense)

**Interfaces:**
- Consumes: `MatchesList` (export nombrado en `frontend/src/components/MatchesList.tsx`).

- [ ] **Step 1: Configurar `manualChunks` en Vite**

Reemplazar el contenido completo de `frontend/vite.config.ts` por:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Separar vendor en chunks propios: mejora cacheo (no cambian entre deploys)
        // y baja el peso del chunk de la app.
        manualChunks: {
          react: ['react', 'react-dom'],
          'framer-motion': ['framer-motion'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  server: {
    host: true,        // escucha en 0.0.0.0 para ser accesible desde fuera del contenedor
    port: 5173,
    watch: {
      usePolling: true, // hot reload sobre bind-mount en Docker Desktop (Mac)
    },
  },
})
```

- [ ] **Step 2: Cargar `MatchesList` de forma diferida en `Swipe`**

En `frontend/src/screens/Swipe.tsx`:

(a) Cambiar el import de React para incluir `lazy` y `Suspense`. La primera línea de imports queda:

```ts
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
```

(b) Eliminar el import estático de `MatchesList`:

```ts
import { MatchesList } from '../components/MatchesList';
```

y reemplazarlo por la versión diferida (debajo de los demás imports, antes de `export function Swipe`):

```ts
// Se carga solo al abrir el modal de matches (no se necesita en el primer paint).
const MatchesList = lazy(() =>
  import('../components/MatchesList').then((m) => ({ default: m.MatchesList })),
);
```

(c) Envolver el render de `MatchesList` en `Suspense`. Reemplazar:

```tsx
      {showMatches && <MatchesList onClose={() => setShowMatches(false)} />}
```

por:

```tsx
      {showMatches && (
        <Suspense fallback={null}>
          <MatchesList onClose={() => setShowMatches(false)} />
        </Suspense>
      )}
```

- [ ] **Step 3: Verificar el build y el chunking**

Run: `docker compose run --rm frontend npm --workspace frontend run build`
Expected: build exitoso; aparecen chunks separados (`react`, `framer-motion`, `supabase`, `MatchesList`) y el chunk principal de la app queda bajo 500 kB (idealmente sin el warning de >500 kB). Si la versión de Vite/rolldown rechaza `manualChunks`, usar el campo que indique el propio mensaje de build (`build.rolldownOptions.output`) para lograr el mismo split, y dejar registrado el ajuste.

- [ ] **Step 4: Commit**

```bash
git add frontend/vite.config.ts frontend/src/screens/Swipe.tsx
git commit -m "perf(frontend): separar vendor en chunks + lazy load de MatchesList"
```

---

### Task 4: Persistir la usuaria

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/screens/Swipe.tsx` (prop `onSwitch` + control "cambiar")

**Interfaces:**
- Produces: `Swipe` ahora recibe `onSwitch: () => void` además de `user`.

- [ ] **Step 1: Persistir y rehidratar la usuaria en `App.tsx`**

Reemplazar el contenido completo de `frontend/src/App.tsx` por:

```tsx
// frontend/src/App.tsx
import { useState } from 'react';
import './index.css';
import { Gate } from './screens/Gate';
import { UserSelect } from './screens/UserSelect';
import { Import } from './screens/Import';
import { Swipe } from './screens/Swipe';
import type { UserName } from './types';

type Screen = 'gate' | 'user' | 'import' | 'swipe';

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

  // Elegir usuaria: se recuerda para próximas recargas.
  function pick(u: UserName) {
    localStorage.setItem('user', u);
    setUser(u);
    setScreen('import');
  }

  // Cambiar usuaria: olvida la elección y vuelve a seleccionar (pasa de nuevo por Import).
  function switchUser() {
    localStorage.removeItem('user');
    setUser(null);
    setScreen('user');
  }

  if (screen === 'gate') return <Gate onOk={() => setScreen('user')} />;
  if (screen === 'user') return <UserSelect onPick={pick} />;
  if (screen === 'import' && user) return <Import user={user} onDone={() => setScreen('swipe')} />;
  if (screen === 'swipe' && user) return <Swipe user={user} onSwitch={switchUser} />;
  return null;
}
```

- [ ] **Step 2: Aceptar `onSwitch` y exponer el control "cambiar" en `Swipe`**

En `frontend/src/screens/Swipe.tsx`:

(a) Cambiar la firma del componente:

```tsx
export function Swipe({ user, onSwitch }: { user: UserName; onSwitch: () => void }) {
```

(b) En el header, reemplazar el `<span>` de la usuaria:

```tsx
        <span className="text-neutral-500">{user}</span>
```

por el nombre + botón "cambiar":

```tsx
        <div className="flex items-center gap-2">
          <span className="text-neutral-500">{user}</span>
          <button onClick={onSwitch} className="text-xs text-neutral-500 underline">cambiar</button>
        </div>
```

- [ ] **Step 3: Verificar el build**

Run: `docker compose run --rm frontend npm --workspace frontend run build`
Expected: build exitoso, sin errores de TS (la prop `onSwitch` queda satisfecha desde `App`).

- [ ] **Step 4: Verificación manual**

Levantar (`docker compose up`), entrar y elegir usuaria. Recargar la página → debe ir directo a la pantalla de swipe (sin pedir usuaria ni importar). Tocar "cambiar" → vuelve a la selección de usuaria.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/screens/Swipe.tsx
git commit -m "feat(frontend): persistir la usuaria entre recargas + control cambiar"
```

---

### Task 5: Presencia con estados ricos

**Files:**
- Modify: `frontend/src/types.ts` (tipo `PresenceStatus`)
- Create: `frontend/src/components/PresenceBadge.tsx`
- Modify: `frontend/src/screens/Swipe.tsx` (derivar `myStatus`, `deckLoaded`, montar el badge)

**Interfaces:**
- Consumes: `supabase` de `../supabase`; `UserName` de `../types`.
- Produces: `export type PresenceStatus = 'en-linea' | 'swipeando' | 'termino'`; componente `PresenceBadge({ me: UserName; myStatus: PresenceStatus })`.

- [ ] **Step 1: Agregar el tipo `PresenceStatus`**

En `frontend/src/types.ts`, agregar al final:

```ts
// Estado de actividad para la presencia en vivo (no expone likes, solo actividad).
export type PresenceStatus = 'en-linea' | 'swipeando' | 'termino';
```

- [ ] **Step 2: Crear el `PresenceBadge`**

Crear `frontend/src/components/PresenceBadge.tsx`:

```tsx
// frontend/src/components/PresenceBadge.tsx
import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import type { UserName, PresenceStatus } from '../types';

const LABEL: Record<PresenceStatus, string> = {
  'en-linea': 'en línea',
  'swipeando': 'swipeando',
  'termino': 'terminó su mazo',
};

type TrackPayload = { user: UserName; status: PresenceStatus };

// Encapsula el canal Realtime Presence: publica MI estado y muestra el de la OTRA.
export function PresenceBadge({ me, myStatus }: { me: UserName; myStatus: PresenceStatus }) {
  const [otherStatus, setOtherStatus] = useState<PresenceStatus | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Crear el canal una sola vez por usuaria.
  useEffect(() => {
    const channel = supabase.channel('presence', { config: { presence: { key: me } } });
    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<TrackPayload>();
        let found: PresenceStatus | null = null;
        for (const key of Object.keys(state)) {
          for (const pres of state[key]) {
            if (pres.user !== me) found = pres.status;
          }
        }
        setOtherStatus(found);
      })
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') channel.track({ user: me, status: myStatus });
      });

    return () => { supabase.removeChannel(channel); channelRef.current = null; };
  }, [me]);

  // Re-trackear cuando cambia mi estado, sin recrear el canal.
  useEffect(() => {
    channelRef.current?.track({ user: me, status: myStatus });
  }, [me, myStatus]);

  const other: UserName = me === 'Jo' ? 'Vale' : 'Jo';
  const texto = otherStatus ? LABEL[otherStatus] : 'desconectada';
  const color = otherStatus ? 'bg-emerald-500' : 'bg-neutral-600';

  return (
    <div className="flex items-center gap-1.5 py-1 text-xs text-neutral-400">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span>{other}: {texto}</span>
    </div>
  );
}
```

- [ ] **Step 3: Derivar `myStatus` y montar el badge en `Swipe`**

En `frontend/src/screens/Swipe.tsx`:

(a) Importar el tipo y el componente. Agregar a los imports:

```ts
import type { UserName, PresenceStatus } from '../types';
import { PresenceBadge } from '../components/PresenceBadge';
```

(Nota: si ya existe `import type { UserName } from '../types';`, reemplazarlo por la línea con `UserName, PresenceStatus`.)

(b) Agregar el estado `deckLoaded` junto a los demás `useState`:

```tsx
  const [deckLoaded, setDeckLoaded] = useState(false);
```

(c) En el `useEffect` que pide el deck, marcar `deckLoaded`. Reemplazar:

```tsx
  useEffect(() => { api.get(`/deck?user=${user}`).then((r) => setDeck(r.deck)); }, [user]);
```

por:

```tsx
  useEffect(() => {
    api.get(`/deck?user=${user}`).then((r) => { setDeck(r.deck); setDeckLoaded(true); });
  }, [user]);
```

(d) En `softReset`, resetear `deckLoaded` y volver a marcarlo al recargar el deck. Reemplazar el cuerpo de `softReset` que hace el fetch del deck:

```tsx
    x.set(0);
    api.get(`/deck?user=${user}`).then((r) => setDeck(r.deck));
  }
```

por:

```tsx
    x.set(0);
    setDeckLoaded(false);
    api.get(`/deck?user=${user}`).then((r) => { setDeck(r.deck); setDeckLoaded(true); });
  }
```

(e) Derivar `myStatus` justo antes del `return` principal (después de `const top = deck[0];` ya existente sirve, pero colócalo cerca del return, fuera del bloque `if (chosen)`):

```tsx
  const myStatus: PresenceStatus = !deckLoaded ? 'en-linea' : deck.length > 0 ? 'swipeando' : 'termino';
```

(f) Montar el badge debajo del `<header>`. Justo después de la etiqueta de cierre `</header>`, agregar:

```tsx
      <PresenceBadge me={user} myStatus={myStatus} />
```

- [ ] **Step 4: Verificar el build**

Run: `docker compose run --rm frontend npm --workspace frontend run build`
Expected: build exitoso, sin errores de TS.

- [ ] **Step 5: Verificación manual con dos navegadores**

Levantar (`docker compose up`) y abrir como Jo y como Vale en dos navegadores:
1. Cada una ve el badge de la otra: "en línea" al entrar, "swipeando" mientras hay cartas, "terminó su mazo" al vaciar el mazo.
2. Al cerrar una pestaña, la otra pasa a "desconectada" en unos segundos.

(Verificación manual; no hay test automatizado de frontend.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/components/PresenceBadge.tsx frontend/src/screens/Swipe.tsx
git commit -m "feat(frontend): presencia en vivo con estados (en línea / swipeando / terminó)"
```

---

## Notas de cierre

- **Sin migración de BD:** nada de este plan toca el esquema. Las migraciones pendientes
  (bloque crítico y `avatar_url`) son independientes y ya están documentadas.
- **Deploy:** tras mergear, push → redeploy de Vercel (frontend) y Render (backend, por
  el cambio en `match.ts`/`sessions.ts`).
- **Fuera de alcance (confirmado):** "matches vistos" cross-dispositivo (queda en
  localStorage) y la amplificación de `reconcile` en `/matches` (backstop deliberado).
