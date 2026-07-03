import { supabase } from './db.js';
import { TABLES, RPC } from './constants.js';

export async function recordSwipeAndDetectMatch(
  sessionId: string, userId: string, movieId: string, liked: boolean,
): Promise<{ matched: boolean }> {
  const { data, error } = await supabase.rpc(RPC.recordSwipeAndDetectMatch, {
    p_session_id: sessionId,
    p_user_id: userId,
    p_movie_id: movieId,
    p_liked: liked,
  });
  if (error) throw error;
  return { matched: data === true };
}

export async function reconcileMatches(sessionId: string): Promise<void> {
  const { data: likes } = await supabase
    .from(TABLES.swipes).select('movie_id, user_id')
    .eq('session_id', sessionId).eq('liked', true);
  if (!likes) return;

  const usersByMovie = new Map<string, Set<string>>();
  for (const { movie_id, user_id } of likes as { movie_id: string; user_id: string }[]) {
    const set = usersByMovie.get(movie_id) ?? new Set<string>();
    set.add(user_id);
    usersByMovie.set(movie_id, set);
  }

  const matched = [...usersByMovie.entries()]
    .filter(([, users]) => users.size >= 2)
    .map(([movieId]) => movieId);

  await Promise.all(
    matched.map((movieId) =>
      supabase.from(TABLES.matches).upsert(
        { session_id: sessionId, movie_id: movieId },
        { onConflict: 'session_id,movie_id', ignoreDuplicates: true },
      ),
    ),
  );
}

export async function undoSwipe(
  sessionId: string, userId: string, movieId: string,
): Promise<void> {
  await supabase.from(TABLES.swipes).delete()
    .eq('session_id', sessionId).eq('user_id', userId).eq('movie_id', movieId);

  const { data: likers } = await supabase.from(TABLES.swipes).select('user_id')
    .eq('session_id', sessionId).eq('movie_id', movieId).eq('liked', true);
  const distinct = new Set((likers ?? []).map((liker: { user_id: string }) => liker.user_id));
  if (distinct.size < 2) {
    await supabase.from(TABLES.matches).delete()
      .eq('session_id', sessionId).eq('movie_id', movieId);
  }
}
