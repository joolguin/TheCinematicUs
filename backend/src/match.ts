// backend/src/match.ts
import { supabase } from './db.js';

// Registra el swipe y detecta match. La lectura cruzada (swipes de la otra usuaria)
// la hace SOLO el backend con service role: el frontend nunca ve los likes ajenos.
export async function recordSwipeAndDetectMatch(
  sessionId: string, userId: string, movieId: string, liked: boolean,
): Promise<{ matched: boolean }> {
  await supabase.from('swipes').upsert(
    { session_id: sessionId, user_id: userId, movie_id: movieId, liked },
    { onConflict: 'session_id,user_id,movie_id' },
  );

  if (!liked) return { matched: false };

  // ¿La OTRA usuaria ya likeó esta peli en esta sesión?
  const { data: others } = await supabase
    .from('swipes').select('id')
    .eq('session_id', sessionId).eq('movie_id', movieId).eq('liked', true)
    .neq('user_id', userId);

  if (!others || others.length === 0) return { matched: false };

  // Insert idempotente: unique(session_id, movie_id) evita duplicados.
  await supabase.from('matches').insert({ session_id: sessionId, movie_id: movieId });
  return { matched: true };
}

// Backstop de carrera: crea las filas de match que la detección directa pudo perder
// si ambas likearon en el mismo instante. Idempotente vía unique(session_id, movie_id).
export async function reconcileMatches(sessionId: string): Promise<void> {
  const { data: likes } = await supabase
    .from('swipes').select('movie_id, user_id')
    .eq('session_id', sessionId).eq('liked', true);
  if (!likes) return;

  // Agrupar por peli contando usuarias DISTINTAS.
  const usersByMovie = new Map<string, Set<string>>();
  for (const { movie_id, user_id } of likes as { movie_id: string; user_id: string }[]) {
    const set = usersByMovie.get(movie_id) ?? new Set<string>();
    set.add(user_id);
    usersByMovie.set(movie_id, set);
  }

  const matched = [...usersByMovie.entries()]
    .filter(([, users]) => users.size >= 2)
    .map(([movieId]) => movieId);

  for (const movieId of matched) {
    await supabase.from('matches').upsert(
      { session_id: sessionId, movie_id: movieId },
      { onConflict: 'session_id,movie_id', ignoreDuplicates: true },
    );
  }
}
