import { supabase } from './db.js';
import { scrapeWatchlist } from './letterboxd.js';
import { resolveMovie } from './movies.js';
import { getUsers } from './users.js';
import { TABLES } from './constants.js';

const MAX_REMOVAL_RATIO = 0.4;

export interface RefreshResult {
  count: number;
  ok: boolean;
  error?: string;
  kept?: boolean;
}

export async function refreshWatchlistForUser(
  userId: string,
  url: string | null,
): Promise<RefreshResult> {
  if (!url) return { count: 0, ok: false, error: 'sin URL de Letterboxd' };

  let films;
  try {
    films = await scrapeWatchlist(url);
  } catch (error: any) {
    return { count: 0, ok: false, error: error.message };
  }
  if (films.length === 0) return { count: 0, ok: false, error: 'scrape vacío' };

  let ids: string[] = [];
  try {
    for (const film of films) {
      const { id } = await resolveMovie(film.title, film.year);
      ids.push(id);
    }
  } catch (error: any) {
    return { count: 0, ok: false, error: error.message };
  }
  const uniqueIds = [...new Set(ids)];

  const { data: current } = await supabase
    .from(TABLES.watchlistItems).select('movie_id').eq('user_id', userId);
  const prevIds = new Set((current ?? []).map((row: { movie_id: string }) => row.movie_id));
  if (prevIds.size > 0) {
    const newIds = new Set(uniqueIds);
    const removed = [...prevIds].filter((id) => !newIds.has(id)).length;
    const ratio = removed / prevIds.size;
    if (ratio > MAX_REMOVAL_RATIO) {
      return {
        count: prevIds.size,
        ok: false,
        kept: true,
        error: `diff sospechoso: ${Math.round(ratio * 100)}% del pozo desaparecería; se mantiene el set anterior`,
      };
    }
  }

  const now = new Date().toISOString();
  const newSet = new Set(uniqueIds);
  const toInsert = uniqueIds.filter((id) => !prevIds.has(id));
  const toDelete = [...prevIds].filter((id) => !newSet.has(id));

  if (toDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from(TABLES.watchlistItems).delete().eq('user_id', userId).in('movie_id', toDelete);
    if (deleteError) return { count: 0, ok: false, error: deleteError.message };
  }
  if (toInsert.length > 0) {
    const { error: insertError } = await supabase
      .from(TABLES.watchlistItems)
      .insert(toInsert.map((movie_id) => ({ user_id: userId, movie_id, first_seen_at: now })));
    if (insertError) return { count: 0, ok: false, error: insertError.message };
  }

  return { count: uniqueIds.length, ok: true };
}

export async function refreshAllWatchlists(): Promise<Record<string, RefreshResult>> {
  const users = await getUsers();
  const results: Record<string, RefreshResult> = {};
  for (const user of users) {
    results[user.name] = await refreshWatchlistForUser(user.id, user.letterboxd_url);
  }
  return results;
}
