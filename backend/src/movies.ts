// backend/src/movies.ts
import { supabase } from './db.js';
import { searchAndEnrich } from './tmdb.js';

// Clave de cache estable para no re-pedir la misma peli a TMDB.
export function normalizeKey(title: string, year: number | null): string {
  return `${title.toLowerCase().trim()}|${year ?? ''}`;
}

export async function resolveMovie(title: string, year: number | null): Promise<{ id: string }> {
  const key = normalizeKey(title, year);

  // 1. ¿Ya está cacheada? search_key ya no es unique → puede haber duplicados;
  // tomamos la primera. La verdad de identidad es tmdb_id.
  const { data: existing } = await supabase
    .from('movies').select('id').eq('search_key', key).limit(1);
  if (existing && existing.length > 0) return { id: existing[0].id };

  // 2. Resolver contra TMDB (datos mínimos si no hay match)
  const m = await searchAndEnrich(title, year);

  // 3. Insertar en cache. Si otra request la insertó en paralelo, recuperarla.
  const { data: inserted, error } = await supabase.from('movies').insert({
    tmdb_id: m.tmdbId, title: m.title, original_title: m.originalTitle, year: m.year,
    poster_url: m.posterUrl, director: m.director, cast: m.cast, runtime: m.runtime,
    genres: m.genres, overview: m.overview, tmdb_rating: m.tmdbRating, country: m.country,
    enriched: m.enriched, search_key: key,
    fetched_at: m.enriched ? new Date().toISOString() : null,
    last_enrich_attempt_at: new Date().toISOString(),
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
      const r = await supabase.from('movies').select('id').eq('search_key', key).limit(1);
      row = r.data && r.data.length > 0 ? r.data[0] : null;
    }
    // Conflicto inesperado (no era ni tmdb_id ni search_key): propagar el error real,
    // no un confuso "Cannot read properties of null".
    if (!row) throw error;
    return { id: row.id };
  }
  return { id: inserted!.id };
}

// Ventana fija de reintento de enriquecimiento. A esta escala (cientos de pelis,
// 2 usuarias) un reintento diario alcanza; no hace falta backoff exponencial.
const ENRICH_RETRY_MS = 24 * 60 * 60 * 1000;

// Reintenta enriquecer las pelis con enriched=false cuyo último intento fue hace
// más de ENRICH_RETRY_MS (o nunca). Pensado para correr desde un cron (M1.5/§7).
export async function reEnrichStale(now: Date = new Date()): Promise<{ attempted: number; enriched: number }> {
  const cutoff = new Date(now.getTime() - ENRICH_RETRY_MS).toISOString();
  const { data: stale } = await supabase
    .from('movies')
    .select('id, title, year')
    .eq('enriched', false)
    .or(`last_enrich_attempt_at.is.null,last_enrich_attempt_at.lt.${cutoff}`);

  const rows = stale ?? [];
  let enrichedCount = 0;
  for (const row of rows) {
    const m = await searchAndEnrich(row.title, row.year);
    const ts = now.toISOString();
    await supabase.from('movies').update({
      tmdb_id: m.tmdbId, title: m.title, original_title: m.originalTitle, year: m.year,
      poster_url: m.posterUrl, director: m.director, cast: m.cast, runtime: m.runtime,
      genres: m.genres, overview: m.overview, tmdb_rating: m.tmdbRating, country: m.country,
      enriched: m.enriched,
      fetched_at: m.enriched ? ts : null,
      last_enrich_attempt_at: ts,
    }).eq('id', row.id);
    if (m.enriched) enrichedCount++;
  }
  return { attempted: rows.length, enriched: enrichedCount };
}
