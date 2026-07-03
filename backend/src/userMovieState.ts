import { supabase } from './db.js';
import { TABLES } from './constants.js';

export interface MovieState {
  pass_count: number;
  last_passed_at: string | null;
  last_liked_at: string | null;
}

export async function recordMovieState(
  userId: string, movieId: string, liked: boolean,
): Promise<void> {
  const { data: existing } = await supabase
    .from(TABLES.userMovieState)
    .select('pass_count, last_passed_at, last_liked_at')
    .eq('user_id', userId).eq('movie_id', movieId).maybeSingle();
  const now = new Date().toISOString();
  await supabase.from(TABLES.userMovieState).upsert({
    user_id: userId,
    movie_id: movieId,
    pass_count: (existing?.pass_count ?? 0) + (liked ? 0 : 1),
    last_passed_at: liked ? (existing?.last_passed_at ?? null) : now,
    last_liked_at: liked ? now : (existing?.last_liked_at ?? null),
  }, { onConflict: 'user_id,movie_id' });
}

export async function getMovieStates(
  userId: string, movieIds: string[],
): Promise<Map<string, MovieState>> {
  if (movieIds.length === 0) return new Map();
  const { data } = await supabase
    .from(TABLES.userMovieState)
    .select('movie_id, pass_count, last_passed_at, last_liked_at')
    .eq('user_id', userId).in('movie_id', movieIds);
  const states = new Map<string, MovieState>();
  for (const row of (data ?? []) as ({ movie_id: string } & MovieState)[]) {
    states.set(row.movie_id, {
      pass_count: row.pass_count,
      last_passed_at: row.last_passed_at,
      last_liked_at: row.last_liked_at,
    });
  }
  return states;
}

export function orderByNovelty<T extends { id: string }>(
  movies: T[], states: Map<string, MovieState>, firstSeen: Map<string, string> = new Map(),
): T[] {
  return [...movies].sort((first, second) => {
    const firstState = states.get(first.id);
    const secondState = states.get(second.id);
    const firstSeenFlag = firstState ? 1 : 0;
    const secondSeenFlag = secondState ? 1 : 0;
    if (firstSeenFlag !== secondSeenFlag) return firstSeenFlag - secondSeenFlag;
    if (firstSeenFlag === 0) {
      const firstAddedAt = firstSeen.get(first.id) ? Date.parse(firstSeen.get(first.id)!) : 0;
      const secondAddedAt = firstSeen.get(second.id) ? Date.parse(firstSeen.get(second.id)!) : 0;
      return secondAddedAt - firstAddedAt;
    }
    const firstPassedAt = firstState?.last_passed_at ? Date.parse(firstState.last_passed_at) : 0;
    const secondPassedAt = secondState?.last_passed_at ? Date.parse(secondState.last_passed_at) : 0;
    if (firstPassedAt !== secondPassedAt) return firstPassedAt - secondPassedAt;
    return (firstState?.pass_count ?? 0) - (secondState?.pass_count ?? 0);
  });
}
