// backend/src/sessions.ts
import { supabase } from './db.js';

export async function getActiveSession(): Promise<{ id: string }> {
  const { data } = await supabase
    .from('sessions').select('id').eq('active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (data) return { id: data.id };
  return createSession();
}

// Una sesión nueva = noche nueva. Desactiva las viejas para que el mazo arranque de cero.
// El índice único parcial `one_active_session` garantiza una sola activa: si dos llamadas
// concurrentes insertan, una gana y la otra (error 23505) re-lee la ganadora.
export async function createSession(startedBy?: string): Promise<{ id: string }> {
  await supabase.from('sessions').update({ active: false }).eq('active', true);
  const { data, error } = await supabase
    .from('sessions')
    .insert({ mode: 'pool', active: true, started_by: startedBy ?? null })
    .select('id').single();
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      const { data: active } = await supabase
        .from('sessions').select('id').eq('active', true)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (active) return { id: active.id };
    }
    throw error;
  }
  return { id: data.id };
}
