// backend/src/movies.ts
import { supabase } from './db.js';
import { searchAndEnrich } from './tmdb.js';

// Clave de cache estable para no re-pedir la misma peli a TMDB.
export function normalizeKey(title: string, year: number | null): string {
  return `${title.toLowerCase().trim()}|${year ?? ''}`;
}

export async function resolveMovie(title: string, year: number | null): Promise<{ id: string }> {
  const key = normalizeKey(title, year);

  // 1. ¿Ya está cacheada?
  const { data: existing } = await supabase
    .from('movies').select('id').eq('search_key', key).maybeSingle();
  if (existing) return { id: existing.id };

  // 2. Resolver contra TMDB (datos mínimos si no hay match)
  const m = await searchAndEnrich(title, year);

  // 3. Insertar en cache. Si otra request la insertó en paralelo, recuperarla.
  const { data: inserted, error } = await supabase.from('movies').insert({
    tmdb_id: m.tmdbId, title: m.title, original_title: m.originalTitle, year: m.year,
    poster_url: m.posterUrl, director: m.director, cast: m.cast, runtime: m.runtime,
    genres: m.genres, overview: m.overview, tmdb_rating: m.tmdbRating, country: m.country,
    enriched: m.enriched, search_key: key,
  }).select('id').single();

  if (error) {
    const { data: race } = await supabase
      .from('movies').select('id').eq('search_key', key).single();
    return { id: race!.id };
  }
  return { id: inserted!.id };
}
