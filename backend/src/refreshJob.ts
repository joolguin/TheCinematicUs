import { supabase } from './db.js';
import { refreshAllWatchlists } from './watchlists.js';
import { reEnrichStale } from './movies.js';
import { TABLES, REFRESH_JOB_STATUS, REFRESH_STATUS_ROW_ID } from './constants.js';

const STALE_MS = 10 * 60 * 1000;

export async function claimRefresh(now: Date = new Date()): Promise<boolean> {
  const staleCutoff = new Date(now.getTime() - STALE_MS).toISOString();
  
  await supabase
    .from(TABLES.refreshStatus)
    .upsert(
      { id: REFRESH_STATUS_ROW_ID, status: REFRESH_JOB_STATUS.idle },
      { onConflict: 'id', ignoreDuplicates: true },
    );
  const { data } = await supabase
    .from(TABLES.refreshStatus)
    .update({
      status: REFRESH_JOB_STATUS.running,
      started_at: now.toISOString(),
      finished_at: null,
      updated_at: now.toISOString(),
    })
    .eq('id', REFRESH_STATUS_ROW_ID)
    .or(`status.neq.${REFRESH_JOB_STATUS.running},started_at.lt.${staleCutoff}`)
    .select('id');
  return !!(data && data.length > 0);
}

export async function runRefreshJob(): Promise<void> {
  try {
    const result = await refreshAllWatchlists();
    const reenriched = await reEnrichStale();
    await supabase.from(TABLES.refreshStatus).update({
      status: REFRESH_JOB_STATUS.done,
      finished_at: new Date().toISOString(),
      result: { ...result, reenriched },
      updated_at: new Date().toISOString(),
    }).eq('id', REFRESH_STATUS_ROW_ID);
  } catch (error: any) {
    await supabase.from(TABLES.refreshStatus).update({
      status: REFRESH_JOB_STATUS.error,
      finished_at: new Date().toISOString(),
      result: { error: error.message },
      updated_at: new Date().toISOString(),
    }).eq('id', REFRESH_STATUS_ROW_ID);
  }
}
