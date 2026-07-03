import { supabase } from './db.js';
import { TABLES } from './constants.js';

const userIdCache = new Map<string, { id: string }>();

export function clearUserCache(): void {
  userIdCache.clear();
}

export async function getUserByName(name: string): Promise<{ id: string }> {
  const cached = userIdCache.get(name);
  if (cached) return cached;

  const { data, error } = await supabase
    .from(TABLES.users).select('id').eq('name', name).single();
  if (error) {
    console.error('[getUserByName] error de Supabase:', error);
    throw new Error(`Error consultando usuaria "${name}": ${error.message}`);
  }
  if (!data) throw new Error(`Usuaria desconocida: ${name}`);

  const user = { id: data.id };
  userIdCache.set(name, user);
  return user;
}

export interface User {
  id: string;
  name: string;
  letterboxd_url: string | null;
}

export async function getUsers(): Promise<User[]> {
  const { data, error } = await supabase.from(TABLES.users).select('id, name, letterboxd_url');
  if (error) {
    console.error('[getUsers] error de Supabase:', error);
    throw new Error(`Error listando usuarias: ${error.message}`);
  }
  return data ?? [];
}
