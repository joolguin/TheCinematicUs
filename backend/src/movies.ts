import { supabase } from './db.js';
import { searchAndEnrich } from './tmdb.js';
import { TABLES } from './constants.js';

export function normalizeKey(title: string, year: number | null): string {
  return `${title.toLowerCase().trim()}|${year ?? ''}`;
}

export async function resolveMovie(title: string, year: number | null): Promise<{ id: string }> {
  const key = normalizeKey(title, year);

  const { data: existing } = await supabase
    .from(TABLES.movies).select('id').eq('search_key', key).limit(1);
  if (existing && existing.length > 0) return { id: existing[0].id };

  const movie = await searchAndEnrich(title, year);

  const { data: inserted, error } = await supabase.from(TABLES.movies).insert({
    tmdb_id: movie.tmdbId, title: movie.title, original_title: movie.originalTitle, year: movie.year,
    poster_url: movie.posterUrl, director: movie.director, cast: movie.cast, runtime: movie.runtime,
    genres: movie.genres, overview: movie.overview, tmdb_rating: movie.tmdbRating, country: movie.country,
    enriched: movie.enriched, search_key: key,
    fetched_at: movie.enriched ? new Date().toISOString() : null,
    last_enrich_attempt_at: new Date().toISOString(),
  }).select('id').single();

  if (error) {
    let row: { id: string } | null = null;
    if (movie.tmdbId != null) {
      const byTmdbId = await supabase.from(TABLES.movies).select('id').eq('tmdb_id', movie.tmdbId).maybeSingle();
      row = byTmdbId.data;
    }
    if (!row) {
      const bySearchKey = await supabase.from(TABLES.movies).select('id').eq('search_key', key).limit(1);
      row = bySearchKey.data && bySearchKey.data.length > 0 ? bySearchKey.data[0] : null;
    }
    if (!row) throw error;
    return { id: row.id };
  }
  return { id: inserted!.id };
}

const ENRICH_RETRY_MS = 24 * 60 * 60 * 1000;

export async function reEnrichStale(now: Date = new Date()): Promise<{ attempted: number; enriched: number }> {
  const cutoff = new Date(now.getTime() - ENRICH_RETRY_MS).toISOString();
  const { data: stale } = await supabase
    .from(TABLES.movies)
    .select('id, title, year')
    .eq('enriched', false)
    .or(`last_enrich_attempt_at.is.null,last_enrich_attempt_at.lt.${cutoff}`);

  const rows = stale ?? [];
  let enrichedCount = 0;
  for (const row of rows) {
    const movie = await searchAndEnrich(row.title, row.year);
    const timestamp = now.toISOString();
    await supabase.from(TABLES.movies).update({
      tmdb_id: movie.tmdbId, title: movie.title, original_title: movie.originalTitle, year: movie.year,
      poster_url: movie.posterUrl, director: movie.director, cast: movie.cast, runtime: movie.runtime,
      genres: movie.genres, overview: movie.overview, tmdb_rating: movie.tmdbRating, country: movie.country,
      enriched: movie.enriched,
      fetched_at: movie.enriched ? timestamp : null,
      last_enrich_attempt_at: timestamp,
    }).eq('id', row.id);
    if (movie.enriched) enrichedCount++;
  }
  return { attempted: rows.length, enriched: enrichedCount };
}
