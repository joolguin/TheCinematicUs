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
