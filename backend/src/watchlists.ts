// backend/src/watchlists.ts
import { supabase } from './db.js';
import { scrapeWatchlist } from './letterboxd.js';
import { resolveMovie } from './movies.js';
import { getUsersWithLetterboxd } from './users.js';

export interface RefreshResult {
  count: number;
  ok: boolean;
  error?: string;
}

// Replace-on-success: solo reemplaza el set si el scrape trajo ≥1 película.
export async function refreshWatchlistForUser(
  userId: string,
  url: string | null,
): Promise<RefreshResult> {
  if (!url) return { count: 0, ok: false, error: 'sin URL de Letterboxd' };

  let films;
  try {
    films = await scrapeWatchlist(url);
  } catch (e: any) {
    return { count: 0, ok: false, error: e.message };
  }
  if (films.length === 0) return { count: 0, ok: false, error: 'scrape vacío' };

  // Resolver cada film (cache + TMDB) y deduplicar por movie_id.
  let ids: string[] = [];
  try {
    for (const f of films) {
      const { id } = await resolveMovie(f.title, f.year);
      ids.push(id);
    }
  } catch (e: any) {
    return { count: 0, ok: false, error: e.message };
  }
  const uniqueIds = [...new Set(ids)];

  // Reemplazo atómico-suficiente: borrar el set de la usuaria e insertar el nuevo.
  await supabase.from('watchlist_items').delete().eq('user_id', userId);
  await supabase
    .from('watchlist_items')
    .insert(uniqueIds.map((movie_id) => ({ user_id: userId, movie_id })));

  return { count: uniqueIds.length, ok: true };
}

// Procesa todas las usuarias de forma independiente: una puede fallar sin frenar a la otra.
export async function refreshAllWatchlists(): Promise<Record<string, RefreshResult>> {
  const users = await getUsersWithLetterboxd();
  const out: Record<string, RefreshResult> = {};
  for (const u of users) {
    out[u.name] = await refreshWatchlistForUser(u.id, u.letterboxd_url);
  }
  return out;
}
