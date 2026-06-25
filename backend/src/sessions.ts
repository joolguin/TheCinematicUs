// backend/src/sessions.ts
import { supabase } from './db.js';
import type { SessionFilters } from './filters.js';

export async function getActiveSession(): Promise<{ id: string; filters: SessionFilters | null }> {
  const { data } = await supabase
    .from('sessions').select('id, filters').eq('active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (data) return { id: data.id, filters: (data.filters as SessionFilters | null) ?? null };
  const created = await createSession();
  return { id: created.id, filters: null };
}

// Una sesión nueva = noche nueva. Desactiva las viejas para que el mazo arranque de cero.
// El índice único parcial `one_active_session` garantiza una sola activa: si dos llamadas
// concurrentes insertan, una gana y la otra (error 23505) re-lee la ganadora.
export async function createSession(startedBy?: string): Promise<{ id: string }> {
  // Cerrar la(s) sesión(es) activa(s) con timestamp de fin (la noche que termina).
  await supabase.from('sessions')
    .update({ active: false, ended_at: new Date().toISOString() }).eq('active', true);
  const { data, error } = await supabase
    .from('sessions')
    .insert({ mode: 'pool', active: true, started_by: startedBy ?? null })
    .select('id').single();
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
  return { id: data.id };
}
