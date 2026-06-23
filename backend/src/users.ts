// backend/src/users.ts
import { supabase } from './db.js';

export async function getUserByName(name: string): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('users').select('id').eq('name', name).single();
  if (error) {
    // Logueamos el detalle real de Supabase para diagnosticar (key inválida, RLS, etc.)
    console.error('[getUserByName] error de Supabase:', error);
    throw new Error(`Error consultando usuaria "${name}": ${error.message}`);
  }
  if (!data) throw new Error(`Usuaria desconocida: ${name}`);
  return { id: data.id };
}
