# Refresh asíncrono + cron diario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Volver `POST /watchlists/refresh` asíncrono (202 + estado por Realtime) y agregar un refresh automático diario vía Supabase pg_cron, cableando `reEnrichStale`.

**Architecture:** El endpoint reclama un lock en una tabla singleton `refresh_status`, responde 202, y corre el refresh en background (fire-and-forget) escribiendo su estado. El frontend (anon) lee `refresh_status` por Realtime. Un cron de Supabase (pg_cron + pg_net) pega al endpoint a diario con la passphrase.

**Tech Stack:** Node 24 (alpine), TypeScript ESM, Express, `@supabase/supabase-js`, vitest (backend). React 19 + Vite + Supabase Realtime (frontend, sin runner). Supabase pg_cron + pg_net (cron, manual).

## Global Constraints

- **Todo corre en Docker. Nunca `npm`/`node` en el host.** Desde la raíz `/Users/jo/Documents/TheCinematicUs`:
  - backend suite: `docker compose run --rm --workdir /app/backend backend npm test`
  - backend 1 file: `docker compose run --rm --workdir /app/backend backend npx vitest run src/<archivo>.test.ts`
  - backend build: `docker compose run --rm --workdir /app/backend backend npm run build`
  - frontend typecheck: `docker compose run --rm --workdir /app/frontend frontend npx tsc -b`
- **ESM:** imports internos con extensión `.js` (backend).
- **Migraciones idempotentes:** DDL al final de `backend/db/schema.sql` con `if not exists` / guardas, reflejado en el `create table` de cabecera. Se aplica a mano en Supabase (el implementador solo edita el archivo; NO se conecta a Supabase).
- **Commits normales por tarea, mensaje en español, estilo repo. NO trailer `Co-Authored-By: Claude`.**
- **Auth del cron:** header `x-passphrase` = `APP_PASSPHRASE` (middleware `requirePassphrase`).
- **Lock:** `claimRefresh` reclama si `status <> 'running' OR started_at < now()-10min`. Job de fondo nunca queda colgado (try/catch → `status='error'`).
- **`refresh_status` es singleton** (`id = 1`), anon-readable, en la publicación `supabase_realtime`. Solo expone conteos + ok/error (no likes).

---

### Task 1: Tabla `refresh_status` (DDL + RLS + Realtime)

**Files:**
- Modify: `backend/db/schema.sql`

**Interfaces:**
- Produces (DB): tabla `refresh_status(id, status, started_at, finished_at, result, updated_at)`, singleton `id=1`, anon SELECT, publicada en Realtime.

- [ ] **Step 1: Agregar el `create table` en la cabecera de `schema.sql`**

Después del `create table matches (...)` (antes del seed de `users`), agregar:

```sql
-- Estado del último refresh de watchlists (singleton). El frontend (anon) lo
-- lee por Realtime para saber cuándo terminó. Solo conteos, no likes.
create table refresh_status (
  id int primary key default 1,
  status text not null default 'idle',   -- 'idle' | 'running' | 'done' | 'error'
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb,
  updated_at timestamptz not null default now(),
  constraint refresh_status_singleton check (id = 1)
);
insert into refresh_status (id, status) values (1, 'idle') on conflict (id) do nothing;
```

- [ ] **Step 2: Habilitar RLS + policy anon + Realtime en la cabecera**

En la sección de RLS (junto a los otros `alter table ... enable row level security` y `create policy`), agregar:

```sql
alter table refresh_status enable row level security;
create policy "anon lee refresh_status" on refresh_status for select to anon using (true);
```

Y en la sección de Realtime (junto a los otros `alter publication supabase_realtime add table`):

```sql
alter publication supabase_realtime add table refresh_status;
```

- [ ] **Step 3: Agregar el bloque de migración idempotente al final del archivo**

```sql
-- ─────────────────────────────────────────────────────────────
-- Migración M3 refresh async (2026-06-24): tabla refresh_status para
-- el estado del refresh asíncrono, leída por el frontend vía Realtime.
-- ─────────────────────────────────────────────────────────────
create table if not exists refresh_status (
  id int primary key default 1,
  status text not null default 'idle',
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb,
  updated_at timestamptz not null default now(),
  constraint refresh_status_singleton check (id = 1)
);
insert into refresh_status (id, status) values (1, 'idle') on conflict (id) do nothing;
alter table refresh_status enable row level security;
drop policy if exists "anon lee refresh_status" on refresh_status;
create policy "anon lee refresh_status" on refresh_status for select to anon using (true);
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'refresh_status'
  ) then
    alter publication supabase_realtime add table refresh_status;
  end if;
end $$;
```

- [ ] **Step 4: Commit**

```bash
git add backend/db/schema.sql
git commit -m "feat(backend): tabla refresh_status (singleton, anon-readable, Realtime)"
```

---

### Task 2: Job de fondo (`refreshJob.ts`)

**Files:**
- Create: `backend/src/refreshJob.ts`
- Test: `backend/src/refreshJob.test.ts`

**Interfaces:**
- Consumes: `refreshAllWatchlists()` de `./watchlists.js` (devuelve `Record<string, { count: number; ok: boolean; error?: string }>`); `reEnrichStale()` de `./movies.js` (devuelve `{ attempted: number; enriched: number }`); `supabase` de `./db.js`.
- Produces:
  - `claimRefresh(now?: Date): Promise<boolean>`
  - `runRefreshJob(): Promise<void>`

- [ ] **Step 1: Escribir los tests que fallan**

Create `backend/src/refreshJob.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let claimData: any[];          // data devuelta por el .select('id') del claim
let refreshResult: any;
let reenrichResult: any;
let refreshThrows = false;
let reenrichThrows = false;
const updateMock = vi.fn();     // captura los payloads de .update()

vi.mock('./watchlists.js', () => ({
  refreshAllWatchlists: vi.fn(() =>
    refreshThrows ? Promise.reject(new Error('scrape down')) : Promise.resolve(refreshResult)),
}));
vi.mock('./movies.js', () => ({
  reEnrichStale: vi.fn(() =>
    reenrichThrows ? Promise.reject(new Error('tmdb down')) : Promise.resolve(reenrichResult)),
}));

// El builder de supabase es "thenable": .update().eq() se puede await-ear
// directo (runRefreshJob) y también encadenar .or().select() (claimRefresh).
vi.mock('./db.js', () => ({
  supabase: {
    from: () => ({
      update: (payload: any) => {
        updateMock(payload);
        const eqResult: any = {
          or: () => ({ select: () => Promise.resolve({ data: claimData }) }),
          then: (onF: any, onR: any) => Promise.resolve({ error: null }).then(onF, onR),
        };
        return { eq: () => eqResult };
      },
    }),
  },
}));

import { claimRefresh, runRefreshJob } from './refreshJob.js';

beforeEach(() => {
  claimData = [{ id: 1 }];
  refreshResult = { Jo: { count: 5, ok: true } };
  reenrichResult = { attempted: 2, enriched: 1 };
  refreshThrows = false;
  reenrichThrows = false;
  updateMock.mockClear();
});

describe('claimRefresh', () => {
  it('devuelve true cuando el update condicional afecta la fila', async () => {
    claimData = [{ id: 1 }];
    expect(await claimRefresh()).toBe(true);
  });
  it('devuelve false cuando ya hay un refresh corriendo (no afecta filas)', async () => {
    claimData = [];
    expect(await claimRefresh()).toBe(false);
  });
});

describe('runRefreshJob', () => {
  it('escribe status=done con conteos + reenriched', async () => {
    await runRefreshJob();
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0]).toMatchObject({
      status: 'done',
      result: { Jo: { count: 5, ok: true }, reenriched: { attempted: 2, enriched: 1 } },
    });
  });
  it('escribe status=error si el refresh falla', async () => {
    refreshThrows = true;
    await runRefreshJob();
    expect(updateMock.mock.calls[0][0]).toMatchObject({ status: 'error', result: { error: 'scrape down' } });
  });
  it('escribe status=error si el reEnrich falla', async () => {
    reenrichThrows = true;
    await runRefreshJob();
    expect(updateMock.mock.calls[0][0]).toMatchObject({ status: 'error', result: { error: 'tmdb down' } });
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `docker compose run --rm --workdir /app/backend backend npx vitest run src/refreshJob.test.ts`
Expected: FAIL — `Cannot find module './refreshJob.js'`.

- [ ] **Step 3: Implementar `refreshJob.ts`**

Create `backend/src/refreshJob.ts`:

```ts
// backend/src/refreshJob.ts
// Orquesta el refresh asíncrono: reclama el lock en refresh_status, corre el
// scrape + reEnrich en background, y escribe el resultado. El endpoint responde
// 202 antes de que esto termine.
import { supabase } from './db.js';
import { refreshAllWatchlists } from './watchlists.js';
import { reEnrichStale } from './movies.js';

// Lock con escape: si un run quedó colgado, se libera a los 10 minutos.
const STALE_MS = 10 * 60 * 1000;

// Reclama el refresh con un UPDATE condicional atómico. true = lo reclamó esta
// llamada; false = ya hay uno corriendo (y reciente).
export async function claimRefresh(now: Date = new Date()): Promise<boolean> {
  const staleCutoff = new Date(now.getTime() - STALE_MS).toISOString();
  const { data } = await supabase
    .from('refresh_status')
    .update({
      status: 'running',
      started_at: now.toISOString(),
      finished_at: null,
      updated_at: now.toISOString(),
    })
    .eq('id', 1)
    .or(`status.neq.running,started_at.lt.${staleCutoff}`)
    .select('id');
  return !!(data && data.length > 0);
}

// Corre el refresh + reEnrich (asume lock ya reclamado) y deja el resultado en
// refresh_status. Atrapa cualquier error → status='error' (nunca queda colgado).
export async function runRefreshJob(): Promise<void> {
  try {
    const result = await refreshAllWatchlists();
    const reenriched = await reEnrichStale();
    await supabase.from('refresh_status').update({
      status: 'done',
      finished_at: new Date().toISOString(),
      result: { ...result, reenriched },
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
  } catch (e: any) {
    await supabase.from('refresh_status').update({
      status: 'error',
      finished_at: new Date().toISOString(),
      result: { error: e.message },
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
  }
}
```

- [ ] **Step 4: Correr y verificar verde**

Run: `docker compose run --rm --workdir /app/backend backend npx vitest run src/refreshJob.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Correr el suite completo**

Run: `docker compose run --rm --workdir /app/backend backend npm test`
Expected: PASS (sin regresiones).

- [ ] **Step 6: Commit**

```bash
git add backend/src/refreshJob.ts backend/src/refreshJob.test.ts
git commit -m "feat(backend): refreshJob — claimRefresh (lock) + runRefreshJob (refresh + reEnrich)"
```

---

### Task 3: Endpoint `POST /watchlists/refresh` asíncrono (202)

**Files:**
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `claimRefresh`, `runRefreshJob` de `./refreshJob.js`.
- Produces (HTTP): `POST /watchlists/refresh` → `202 { status: 'running', already?: true }`.

- [ ] **Step 1: Importar el job y cambiar el handler**

En `backend/src/index.ts`, reemplazar el import de watchlists y el handler.

Cambiar el import:

```ts
import { claimRefresh, runRefreshJob } from './refreshJob.js';
```

(Se puede quitar `import { refreshAllWatchlists } from './watchlists.js';` si ya
no se usa en `index.ts` — `refreshAllWatchlists` ahora lo llama `refreshJob.ts`.)

Reemplazar el handler `app.post('/watchlists/refresh', ...)` por:

```ts
// Refresca el pozo en background. Responde 202 al toque; el estado real va a
// refresh_status (que el frontend lee por Realtime). El cron diario de Supabase
// pega a este mismo endpoint.
app.post('/watchlists/refresh', async (_req, res) => {
  try {
    const claimed = await claimRefresh();
    if (!claimed) {
      res.status(202).json({ status: 'running', already: true });
      return;
    }
    res.status(202).json({ status: 'running' });
    // Background, sin await. runRefreshJob escribe su propio estado; el .catch
    // es red de seguridad por si falla el propio write de error.
    runRefreshJob().catch((e) => console.error('[refresh job]', e));
  } catch (e: any) {
    console.error('[error endpoint]', e);
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 2: Build del backend**

Run: `docker compose run --rm --workdir /app/backend backend npm run build`
Expected: `tsc` sin errores (confirma que no quedó un import colgado de `refreshAllWatchlists`).

- [ ] **Step 3: Correr el suite (regresión)**

Run: `docker compose run --rm --workdir /app/backend backend npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(backend): /watchlists/refresh asíncrono (202 + job de fondo con lock)"
```

---

### Task 4: SQL del cron (`cron.sql`) — documentado, manual

**Files:**
- Create: `backend/db/cron.sql`

**Interfaces:** ninguna en código. Es un artefacto SQL que la usuaria aplica a mano en el SQL editor de Supabase.

- [ ] **Step 1: Crear `backend/db/cron.sql`**

Create `backend/db/cron.sql`:

```sql
-- backend/db/cron.sql
-- Refresh automático diario de watchlists vía Supabase pg_cron + pg_net.
-- APLICAR A MANO en el SQL editor de Supabase. Reemplazar los <placeholders>.
-- No commitear con valores reales (la passphrase es secreta).

-- 1) Extensiones (una vez; también se pueden activar desde el dashboard).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) Programar el refresh diario.
-- pg_cron corre en UTC: 21:00 UTC ≈ 18:00 America/Santiago (con DST cae
-- 17:00–18:00, irrelevante para un refresh diario).
-- timeout_milliseconds alto para aguantar el cold-start de Render free (~30s).
select cron.schedule(
  'daily-watchlist-refresh',
  '0 21 * * *',
  $$
  select net.http_post(
    url := 'https://<TU-BACKEND>.onrender.com/watchlists/refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-passphrase', '<APP_PASSPHRASE>'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Útiles:
--   select * from cron.job;                              -- ver jobs
--   select cron.unschedule('daily-watchlist-refresh');   -- borrar/reprogramar
--   select * from net._http_response order by created desc limit 5;  -- respuestas recientes
```

- [ ] **Step 2: Commit**

```bash
git add backend/db/cron.sql
git commit -m "docs(db): cron.sql — refresh diario con pg_cron + pg_net (manual)"
```

---

### Task 5: Frontend — `Watchlists.tsx` asíncrono + estado por Realtime

**Files:**
- Modify: `frontend/src/screens/Watchlists.tsx`

**Interfaces:**
- Consumes: `api.post('/watchlists/refresh', {})` → `202 { status, already? }`; tabla `refresh_status` vía `supabase` (anon) por Realtime.

- [ ] **Step 1: Reescribir `Watchlists.tsx`**

Reemplazar `frontend/src/screens/Watchlists.tsx` por:

```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { supabase } from '../supabase';

type RefreshResult = { count: number; ok: boolean; error?: string };
type RefreshStatus = {
  status: 'idle' | 'running' | 'done' | 'error';
  result:
    | (Record<string, RefreshResult> & {
        reenriched?: { attempted: number; enriched: number };
        error?: string;
      })
    | null;
};

export function Watchlists({ onDone }: { onDone: () => void }) {
  const [status, setStatus] = useState<RefreshStatus>({ status: 'idle', result: null });

  useEffect(() => {
    // Estado actual al abrir la pantalla.
    supabase.from('refresh_status').select('status, result').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (data) setStatus(data as RefreshStatus); });
    // En vivo: el backend escribe refresh_status cuando termina.
    const channel = supabase
      .channel('refresh_status')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'refresh_status' },
        (payload) => setStatus(payload.new as RefreshStatus))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function refresh() {
    await api.post('/watchlists/refresh', {});
    // El estado real llega por Realtime; mostramos 'running' optimista.
    setStatus((s) => ({ ...s, status: 'running' }));
  }

  const running = status.status === 'running';
  const entries = status.result
    ? (Object.entries(status.result).filter(
        ([k]) => k !== 'reenriched' && k !== 'error',
      ) as [string, RefreshResult][])
    : [];

  return (
    <div className="min-h-screen flex flex-col gap-4 p-6 max-w-md mx-auto">
      <h2 className="text-xl">Watchlists de Letterboxd</h2>
      <p className="text-sm text-neutral-500">
        Trae el pozo desde las watchlists públicas. Corre en segundo plano; te aviso cuando termina.
      </p>

      <button
        onClick={refresh}
        disabled={running}
        className="rounded-lg bg-rose-600 px-6 py-3 font-medium disabled:opacity-40"
      >
        {running ? 'Actualizando…' : 'Actualizar watchlists'}
      </button>

      {running && <p className="text-sm text-neutral-400">Actualizando en segundo plano…</p>}

      {(status.status === 'done' || status.status === 'error') && (
        <div className="flex flex-col gap-1 text-sm">
          {entries.map(([name, r]) => (
            <p key={name} className={r.ok ? 'text-neutral-300' : 'text-amber-400'}>
              {r.ok
                ? `${name}: ${r.count} ✓`
                : `${name}: error — se mantuvo la lista anterior${r.error ? ` (${r.error})` : ''}`}
            </p>
          ))}
          {status.status === 'error' && status.result?.error && (
            <p className="text-amber-400">error — {status.result.error}</p>
          )}
          {status.result?.reenriched && (
            <p className="text-neutral-500">re-enriquecidas: {status.result.reenriched.enriched}</p>
          )}
        </div>
      )}

      <button
        onClick={onDone}
        disabled={running}
        className="mt-2 rounded-lg bg-emerald-600 px-6 py-3 font-medium text-neutral-100 disabled:opacity-40"
      >
        Empezar a swipear
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck del frontend**

Run: `docker compose run --rm --workdir /app/frontend frontend npx tsc -b`
Expected: sin errores.

- [ ] **Step 3: Build del frontend (sanity)**

Run: `docker compose run --rm --workdir /app/frontend frontend npm run build`
Expected: build OK.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screens/Watchlists.tsx
git commit -m "feat(frontend): watchlists asíncrono — 202 + estado por Realtime"
```

---

## Verificación manual (tras implementar, con la app levantada y el DDL aplicado)

1. `docker compose up`. Aplicar la migración M3 de `schema.sql` en Supabase (tabla `refresh_status`).
2. Abrir la pantalla de Watchlists, tocar "Actualizar": el botón vuelve a "Actualizando…" al toque (202), y al terminar aparece el conteo por usuaria + "re-enriquecidas" — sin spinner colgado.
3. Tocar dos veces rápido: el segundo POST no lanza otro job (lock).
4. (Cron) Aplicar `cron.sql` con la URL real + passphrase; verificar `select * from cron.job;` y, tras el horario, `select * from net._http_response order by created desc;`.

## Fuera de alcance (anotado)
- Ping anti-cold-start dedicado (§9); el cron ya despierta el backend.
- Historial de refreshes; reintentos del cron.
- Aplicar el DDL y el cron.sql en Supabase (lo hace el humano).
