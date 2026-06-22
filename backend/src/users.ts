// backend/src/users.ts
import { supabase } from './db.js';

export async function getUserByName(name: string): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('users').select('id').eq('name', name).single();
  if (error || !data) throw new Error(`Usuaria desconocida: ${name}`);
  return { id: data.id };
}
