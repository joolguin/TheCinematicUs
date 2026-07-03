import { supabase } from './db.js';
import type { SessionFilters } from './filters.js';
import { TABLES, SESSION_MODE, POSTGRES_ERROR_CODE } from './constants.js';

export async function getActiveSession(): Promise<{ id: string; filters: SessionFilters | null }> {
  const { data } = await supabase
    .from(TABLES.sessions).select('id, filters').eq('active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (data) return { id: data.id, filters: (data.filters as SessionFilters | null) ?? null };
  const created = await createSession();
  return { id: created.id, filters: null };
}

export async function createSession(startedBy?: string): Promise<{ id: string }> {
  await supabase.from(TABLES.sessions)
    .update({ active: false, ended_at: new Date().toISOString() }).eq('active', true);
  const { data, error } = await supabase
    .from(TABLES.sessions)
    .insert({ mode: SESSION_MODE.pool, active: true, started_by: startedBy ?? null })
    .select('id').single();
  if (error) {
    if ((error as { code?: string }).code === POSTGRES_ERROR_CODE.uniqueViolation) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const { data: active } = await supabase
          .from(TABLES.sessions).select('id').eq('active', true)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (active) return { id: active.id };
      }
    }
    throw error;
  }
  return { id: data.id };
}
