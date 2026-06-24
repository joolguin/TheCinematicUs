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
    // El insert pudo fallar por conflicto de search_key (misma búsqueda en paralelo)
    // o de tmdb_id (dos títulos distintos que resuelven a la MISMA peli de TMDB).
    let row: { id: string } | null = null;
    if (m.tmdbId != null) {
      const r = await supabase.from('movies').select('id').eq('tmdb_id', m.tmdbId).maybeSingle();
      row = r.data;
    }
    if (!row) {
      const r = await supabase.from('movies').select('id').eq('search_key', key).maybeSingle();
      row = r.data;
    }
    // Conflicto inesperado (no era ni tmdb_id ni search_key): propagar el error real,
    // no un confuso "Cannot read properties of null".
    if (!row) throw error;
    return { id: row.id };
  }
  return { id: inserted!.id };
}
