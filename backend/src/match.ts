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
