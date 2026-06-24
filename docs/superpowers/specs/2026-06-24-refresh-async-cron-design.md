# Refresh asíncrono + cron diario — Diseño

> Spec para el Milestone 3. Convierte el refresh de watchlists en asíncrono
> (202 + estado por Realtime) y agrega un refresh automático diario vía
> Supabase pg_cron, cableando además `reEnrichStale`.

## 1. Objetivo y contexto

Hoy `POST /watchlists/refresh` es **síncrono**: el frontend espera con un
spinner mientras se scrapean ambas watchlists y se resuelven contra TMDB (cache
fría = lento; en Render free puede acercarse al timeout). Y depende de que
alguien se acuerde de tocar el botón.

Confirmado por la usuaria: **el scrape funciona desde Render** (Cloudflare no lo
bloquea en producción), así que un cron diario tiene sentido.

Cambios:
- `POST /watchlists/refresh` devuelve **202** de inmediato y corre el refresh en
  **background**; el frontend se entera de que terminó por **Realtime**.
- Una **tabla `refresh_status`** (anon-readable, en la publicación Realtime)
  lleva el estado del último refresh.
- **Cron diario** con **Supabase pg_cron + pg_net** que pega al endpoint ~18:00
  Santiago. El botón manual queda como **override**.
- El job de fondo corre `refreshAllWatchlists()` **y** `reEnrichStale()` (que
  hasta ahora no tenía caller).

Cero terceros: el scheduler vive en Supabase (donde ya está la DB).

## 2. Tabla `refresh_status` (singleton)

Una sola fila (`id = 1`) con el estado del último refresh:

```sql
create table refresh_status (
  id int primary key default 1,
  status text not null default 'idle',   -- 'idle' | 'running' | 'done' | 'error'
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb,                            -- ver forma abajo
  updated_at timestamptz not null default now(),
  constraint refresh_status_singleton check (id = 1)
);
insert into refresh_status (id, status) values (1, 'idle') on conflict (id) do nothing;
```

Forma de `result` cuando `status='done'`:
```jsonc
{ "Jo": { "count": 203, "ok": true },
  "Vale": { "count": 188, "ok": true },
  "reenriched": { "attempted": 4, "enriched": 2 } }
```
Cuando `status='error'`: `{ "error": "<mensaje>" }`.

**Privacidad:** la tabla expone solo conteos de watchlists (públicas en
Letterboxd) + ok/error + un mensaje. No hay likes ni datos cruzados. Es seguro
darle SELECT a anon:

```sql
alter table refresh_status enable row level security;
create policy "anon lee refresh_status" on refresh_status for select to anon using (true);
alter publication supabase_realtime add table refresh_status;
```

El backend (service role) es el único que escribe.

## 3. Backend — job de fondo (`refreshJob.ts`)

Módulo nuevo `backend/src/refreshJob.ts` con dos funciones:

### 3.1 `claimRefresh(now?: Date): Promise<boolean>`
Toma el "lock" con un **update condicional atómico** sobre la fila singleton:
reclama si el estado no es `running` **o** si el run anterior quedó colgado
(`started_at` hace más de 10 minutos). Devuelve `true` si lo reclamó.

```ts
export async function claimRefresh(now: Date = new Date()): Promise<boolean> {
  const staleCutoff = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
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
```
(Supabase combina `.eq('id',1)` AND `.or(A,B)` → la condición es
`id=1 AND (status<>'running' OR started_at<cutoff)`. El UPDATE es atómico en la
DB, así que cron y botón manual no se pisan.)

### 3.2 `runRefreshJob(now?: Date): Promise<void>`
Asume que el lock ya fue reclamado. Corre el refresh + reEnrich y escribe el
resultado. Atrapa errores y los deja en `status='error'` (nunca queda colgado).

```ts
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

Consume `refreshAllWatchlists` de `./watchlists.js` y `reEnrichStale` de
`./movies.js` (ya existen).

## 4. Backend — endpoint `POST /watchlists/refresh`

```ts
app.post('/watchlists/refresh', async (_req, res) => {
  try {
    const claimed = await claimRefresh();
    if (!claimed) { res.status(202).json({ status: 'running', already: true }); return; }
    res.status(202).json({ status: 'running' });
    // Background: no se await-ea; escribe su propio estado. El .catch es red de seguridad.
    runRefreshJob().catch((e) => console.error('[refresh job]', e));
  } catch (e: any) {
    console.error('[error endpoint]', e);
    res.status(500).json({ error: e.message });
  }
});
```

Sigue detrás de `requirePassphrase` (el cron manda la passphrase). La respuesta
deja de ser el `Record<…>` de conteos: ahora es `{ status, already? }`.

## 5. Cron — Supabase pg_cron + pg_net (`backend/db/cron.sql`)

Archivo nuevo `backend/db/cron.sql`, **documentado y aplicado a mano** por la
usuaria en el SQL editor (lleva la URL del backend y la passphrase, que no van
al repo con valores reales — quedan como placeholders).

```sql
-- Requiere las extensiones (una vez, desde el dashboard o acá):
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Refresh diario ~18:00 Santiago. pg_cron corre en UTC: 21:00 UTC ≈ 18:00
-- Santiago; con DST cae 17:00–18:00, irrelevante para un refresh diario.
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
-- Para borrar/reprogramar: select cron.unschedule('daily-watchlist-refresh');
```

pg_net dispara el POST y no espera la respuesta (fire-and-forget desde la DB);
alcanza, porque el endpoint responde 202 igual.

## 6. Frontend — `Watchlists.tsx`

- `refresh()` postea y recibe **202**; setea estado local "actualizando en
  segundo plano…". Sigue siendo el botón override.
- Al montar, lee el estado actual:
  `supabase.from('refresh_status').select('*').eq('id', 1).maybeSingle()`.
- Se **suscribe por Realtime** a UPDATE de `refresh_status` (cliente anon). Al
  pasar a `done`/`error`, muestra el resultado por usuaria (sin spinner
  bloqueante). Si se reabre la pantalla, refleja el estado vigente.
- Render del resultado: itera las entradas de `result` salteando la clave
  `reenriched`; muestra `count ✓` u "error — se mantuvo la lista anterior".
  Opcionalmente, una línea con `reenriched.enriched` re-enriquecidas.

La suscripción se limpia en el unmount (`supabase.removeChannel`).

## 7. Manejo de errores y concurrencia
- **Doble disparo** (cron + botón juntos): el segundo `claimRefresh` devuelve
  `false` → 202 `{ already: true }`, sin lanzar otro job.
- **Run colgado** (proceso muere a mitad): el lock se libera solo a los 10 min
  por el escape `started_at < now()-10min`.
- **Error en el scrape/TMDB:** el job lo atrapa y deja `status='error'` +
  `result.error`. El frontend lo muestra. El pozo no se vacía (replace-on-success
  + umbral diff ya lo protegen).
- **Cold-start de Render:** `timeout_milliseconds := 30000` en pg_net aguanta el
  arranque (~30s) antes de abandonar.

## 8. Testing

**Backend (vitest):**
- `refreshJob.test.ts`:
  - `claimRefresh` devuelve `true` cuando el update condicional afecta la fila
    (mock devuelve `data` no vacío) y `false` cuando no (ya corriendo y reciente).
  - `runRefreshJob` con `refreshAllWatchlists` y `reEnrichStale` mockeados:
    escribe `status='done'` con `result` que incluye los conteos **y**
    `reenriched`; ante throw de cualquiera, escribe `status='error'` con
    `result.error`.
- Los endpoints de `index.ts` no se testean (sin `index.test.ts`); el cambio
  del handler se valida con `tsc` (build) + prueba manual.

**pg_cron / pg_net:** se validan a mano (la usuaria aplica `cron.sql` y verifica
con `select * from cron.job;`). Fuera del alcance de tests automáticos.

**Frontend:** sin runner; `tsc -b` + build + prueba manual (tocar el botón, ver
202 + el estado que llega por Realtime).

## 9. Fuera de alcance
- Ping anti-cold-start dedicado de §9 (el cron ya despierta el backend a las 18:00).
- Historial de refreshes (la tabla guarda solo el último; alcanza).
- Reintentos automáticos del cron si falla (queda para el próximo día).

## 10. Resumen de archivos tocados
- `backend/db/schema.sql` — tabla `refresh_status` + RLS + Realtime (header + migración idempotente).
- `backend/db/cron.sql` (nuevo) — setup de pg_cron/pg_net documentado (manual).
- `backend/src/refreshJob.ts` (nuevo) — `claimRefresh`, `runRefreshJob`.
- `backend/src/refreshJob.test.ts` (nuevo).
- `backend/src/index.ts` — `/watchlists/refresh` → 202 + background.
- `frontend/src/screens/Watchlists.tsx` — 202 + suscripción Realtime a `refresh_status`.
