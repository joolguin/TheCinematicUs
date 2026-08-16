import { supabase } from './db.js';
import { fetchById, type MovieData } from './tmdb.js';
import { fetchFilmTmdbRef, type ScrapedFilm, type TmdbRef } from './letterboxd.js';
import { TABLES } from './constants.js';

/**
 * Lee el tmdb_id de la página del film y trae los detalles de TMDB.
 *
 * Siempre re-lee la página en vez de confiar en un tmdb_id ya cacheado: si ese
 * ID estaba muerto en TMDB, puede que Letterboxd ya lo haya corregido.
 *
 * `movie` es null cuando la página no trae `data-tmdb-id` (entonces `ref`
 * también) o cuando el ID que publica Letterboxd está muerto en TMDB. `ref` se
 * devuelve igual para poder cachear el ID aunque la peli no haya resuelto.
 */
async function resolveFromLetterboxd(
  slug: string,
  title: string,
  year: number | null,
): Promise<{ ref: TmdbRef | null; movie: MovieData | null }> {
  const ref = await fetchFilmTmdbRef(slug);
  if (!ref) return { ref: null, movie: null };
  return { ref, movie: await fetchById(ref, title, year) };
}

function movieRow(movie: MovieData, timestamp: string) {
  return {
    tmdb_id: movie.tmdbId, tmdb_type: movie.tmdbType, title: movie.title,
    original_title: movie.originalTitle, year: movie.year, poster_url: movie.posterUrl,
    director: movie.director, cast: movie.cast, runtime: movie.runtime, genres: movie.genres,
    overview: movie.overview, tmdb_rating: movie.tmdbRating, country: movie.country,
    enriched: movie.enriched,
    fetched_at: movie.enriched ? timestamp : null,
    last_enrich_attempt_at: timestamp,
  };
}

/** Inserta la peli; ante conflicto de tmdb_id recupera la fila existente
 *  (dos slugs de Letterboxd pueden apuntar al mismo film de TMDB, y las
 *  filas viejas resueltas por título ya ocupan su tmdb_id).
 *
 *  La fila recuperada se pisa con los datos frescos: las filas legacy no
 *  tienen tmdb_type (es anterior a la columna) y sus datos vienen de una
 *  búsqueda por título. El tmdb_id coincide, así que es la misma peli. */
async function insertOrRecoverMovie(movie: MovieData, timestamp: string): Promise<string> {
  const { data: inserted, error } = await supabase
    .from(TABLES.movies).insert(movieRow(movie, timestamp)).select('id').single();
  if (!error) return inserted!.id;

  if (movie.tmdbId != null) {
    const { data: existing } = await supabase
      .from(TABLES.movies).select('id').eq('tmdb_id', movie.tmdbId).maybeSingle();
    if (existing) {
      await supabase.from(TABLES.movies).update(movieRow(movie, timestamp)).eq('id', existing.id);
      return existing.id;
    }
  }
  throw error;
}

/**
 * Resuelve un film de Letterboxd a una fila de `movies`, cacheando el
 * mapping slug → movie_id en `letterboxd_films`.
 *
 * Cache hit = 0 requests de red. Solo las pelis nuevas pagan la página de
 * Letterboxd (para el tmdb_id) + la llamada a TMDB.
 *
 * Devuelve `null` si no se pudo enriquecer: **no se guarda nada en `movies`**
 * y la peli queda fuera del pozo. Pasa cuando la página no trae
 * `data-tmdb-id` o cuando el ID que publica Letterboxd está muerto en TMDB
 * (existe: entradas borradas o mergeadas del lado de TMDB).
 *
 * El intento igual se cachea, pero con `movie_id` null, y un slug sin
 * `movie_id` **se re-resuelve entero** en el próximo refresh. Así un fallo
 * transitorio de TMDB no expulsa la peli para siempre.
 */
export async function resolveMovie(film: ScrapedFilm): Promise<{ id: string } | null> {
  const { data: cached } = await supabase
    .from(TABLES.letterboxdFilms)
    .select('movie_id')
    .eq('slug', film.slug)
    .maybeSingle();

  if (cached?.movie_id) return { id: cached.movie_id };

  const { ref, movie } = await resolveFromLetterboxd(film.slug, film.title, film.year);

  const timestamp = new Date().toISOString();
  const movieId = movie ? await insertOrRecoverMovie(movie, timestamp) : null;

  await supabase.from(TABLES.letterboxdFilms).upsert(
    {
      slug: film.slug,
      tmdb_id: ref?.tmdbId ?? null,
      tmdb_type: ref?.tmdbType ?? null,
      movie_id: movieId,
      resolved_at: movieId ? timestamp : null,
      last_attempt_at: timestamp,
    },
    { onConflict: 'slug' },
  );

  return movieId ? { id: movieId } : null;
}

const ENRICH_RETRY_MS = 24 * 60 * 60 * 1000;

/** Reintenta las pelis sin enriquecer, pasada la ventana de backoff.
 *  Solo aplica a filas viejas: desde que `resolveMovie` no guarda lo que no
 *  puede enriquecer, no se crean filas nuevas sin enriquecer. Si el reintento
 *  vuelve a fallar, la fila queda como está (solo corre el backoff) — nunca se
 *  le escriben datos vacíos encima. */
export async function reEnrichStale(now: Date = new Date()): Promise<{ attempted: number; enriched: number }> {
  const cutoff = new Date(now.getTime() - ENRICH_RETRY_MS).toISOString();
  const { data: stale } = await supabase
    .from(TABLES.movies)
    .select('id, title, year')
    .eq('enriched', false)
    .or(`last_enrich_attempt_at.is.null,last_enrich_attempt_at.lt.${cutoff}`);

  const rows = stale ?? [];
  if (rows.length === 0) return { attempted: 0, enriched: 0 };

  const { data: links } = await supabase
    .from(TABLES.letterboxdFilms)
    .select('slug, movie_id')
    .in('movie_id', rows.map((row: { id: string }) => row.id));
  const linkByMovieId = new Map<string, any>();
  for (const link of links ?? []) linkByMovieId.set(link.movie_id, link);

  const timestamp = now.toISOString();
  const runBackoff = (movieId: string) =>
    supabase.from(TABLES.movies).update({ last_enrich_attempt_at: timestamp }).eq('id', movieId);
  let enrichedCount = 0;

  for (const row of rows) {
    const link = linkByMovieId.get(row.id);
    if (!link) {
      await runBackoff(row.id);
      continue;
    }

    const { movie } = await resolveFromLetterboxd(link.slug, row.title, row.year);
    if (!movie) {
      await runBackoff(row.id);
      continue;
    }

    await supabase.from(TABLES.movies).update(movieRow(movie, timestamp)).eq('id', row.id);
    await supabase.from(TABLES.letterboxdFilms).update({
      tmdb_id: movie.tmdbId,
      tmdb_type: movie.tmdbType,
      resolved_at: timestamp,
      last_attempt_at: timestamp,
    }).eq('slug', link.slug);

    enrichedCount++;
  }

  return { attempted: rows.length, enriched: enrichedCount };
}
