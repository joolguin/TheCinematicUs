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
export async function createSession(): Promise<{ id: string }> {
  await supabase.from('sessions').update({ active: false }).eq('active', true);
  const { data, error } = await supabase
    .from('sessions').insert({ mode: 'pool', active: true }).select('id').single();
  if (error) throw error;
  return { id: data.id };
}
