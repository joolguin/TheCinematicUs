// backend/src/userMovieState.ts
// Estado acumulado por usuaria cruzando sesiones, para ordenar el mazo por
// novedad. Privado: solo lo lee/escribe el backend (service role).
import { supabase } from './db.js';

export interface MovieState {
  pass_count: number;
  last_passed_at: string | null;
  last_liked_at: string | null;
}

// Registra un swipe en el estado acumulado. Read-modify-write (sin RPC; la
// concurrencia real es nula, una card a la vez). pass → incrementa pass_count y
// marca last_passed_at; like → marca last_liked_at. Preserva el otro timestamp.
export async function recordMovieState(
  userId: string, movieId: string, liked: boolean,
): Promise<void> {
  const { data: existing } = await supabase
    .from('user_movie_state')
    .select('pass_count, last_passed_at, last_liked_at')
    .eq('user_id', userId).eq('movie_id', movieId).maybeSingle();
  const now = new Date().toISOString();
  await supabase.from('user_movie_state').upsert({
    user_id: userId,
    movie_id: movieId,
    pass_count: (existing?.pass_count ?? 0) + (liked ? 0 : 1),
    last_passed_at: liked ? (existing?.last_passed_at ?? null) : now,
    last_liked_at: liked ? now : (existing?.last_liked_at ?? null),
  }, { onConflict: 'user_id,movie_id' });
}

// Estado de la usuaria para un set de pelis (las del deck filtrado).
export async function getMovieStates(
  userId: string, movieIds: string[],
): Promise<Map<string, MovieState>> {
  if (movieIds.length === 0) return new Map();
  const { data } = await supabase
    .from('user_movie_state')
    .select('movie_id, pass_count, last_passed_at, last_liked_at')
    .eq('user_id', userId).in('movie_id', movieIds);
  const map = new Map<string, MovieState>();
  for (const r of (data ?? []) as ({ movie_id: string } & MovieState)[]) {
    map.set(r.movie_id, {
      pass_count: r.pass_count,
      last_passed_at: r.last_passed_at,
      last_liked_at: r.last_liked_at,
    });
  }
  return map;
}

// Orden por novedad: nunca-vistas primero; entre nunca-vistas, recién agregadas
// a la watchlist primero (first_seen_at desc); entre vistas, pasadas hace más
// tiempo primero (last_passed_at null = época 0 = alta prioridad), desempate por menos
// pasadas. Sort estable → empate total preserva el orden de entrada.
export function orderByNovelty<T extends { id: string }>(
  movies: T[], states: Map<string, MovieState>, firstSeen: Map<string, string> = new Map(),
): T[] {
  return [...movies].sort((a, b) => {
    const sa = states.get(a.id);
    const sb = states.get(b.id);
    const seenA = sa ? 1 : 0;
    const seenB = sb ? 1 : 0;
    if (seenA !== seenB) return seenA - seenB;          // nunca-vistas primero
    if (seenA === 0) {                                   // ambas nunca-vistas
      const fa = firstSeen.get(a.id) ? Date.parse(firstSeen.get(a.id)!) : 0;
      const fb = firstSeen.get(b.id) ? Date.parse(firstSeen.get(b.id)!) : 0;
      return fb - fa;                                    // recién agregada primero
    }
    const pa = sa?.last_passed_at ? Date.parse(sa.last_passed_at) : 0;
    const pb = sb?.last_passed_at ? Date.parse(sb.last_passed_at) : 0;
    if (pa !== pb) return pa - pb;
    return (sa?.pass_count ?? 0) - (sb?.pass_count ?? 0);
  });
}
