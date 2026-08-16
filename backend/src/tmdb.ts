import { config } from './config.js';
import type { TmdbRef } from './letterboxd.js';

export interface MovieData {
  tmdbId: number | null;
  tmdbType: string | null;
  title: string;
  originalTitle: string | null;
  year: number | null;
  posterUrl: string | null;
  director: string | null;
  cast: string[] | null;
  runtime: number | null;
  genres: string[] | null;
  overview: string | null;
  tmdbRating: number | null;
  country: string | null;
  enriched: boolean;
}

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_URL = 'https://image.tmdb.org/t/p/w500';
const DIRECTOR_JOB = 'Director';
const MAX_CAST_MEMBERS = 5;

export function parseTitleLine(line: string): { title: string; year: number | null } {
  const trimmed = line.trim();
  const match = trimmed.match(/^(.*?)\s*\((\d{4})\)\s*$/);
  if (match) return { title: match[1].trim(), year: Number(match[2]) };
  return { title: trimmed, year: null };
}

async function tmdbGet(path: string, params: Record<string, string>) {
  const url = new URL(TMDB_BASE_URL + path);
  url.searchParams.set('api_key', config.tmdbApiKey);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`TMDB ${response.status}`);
  return response.json();
}

/**
 * Trae los detalles por ID directo. El ID lo publica Letterboxd en la página
 * del film, así que no hay búsqueda por título de por medio: la peli que
 * devuelve TMDB es exactamente la que Letterboxd tiene linkeada.
 * `tv` normaliza los campos que TMDB nombra distinto (name/first_air_date/...).
 *
 * Devuelve `null` si TMDB no responde con datos. Pasa sobre todo cuando el ID
 * que publica Letterboxd está muerto (404): entradas borradas o mergeadas del
 * lado de TMDB, con el ID cacheado de Letterboxd quedando viejo.
 */
export async function fetchById(
  ref: TmdbRef,
  fallbackTitle: string,
  fallbackYear: number | null,
): Promise<MovieData | null> {
  try {
    const isTv = ref.tmdbType === 'tv';
    const details = await tmdbGet(`/${ref.tmdbType}/${ref.tmdbId}`, { append_to_response: 'credits' });

    const director = isTv
      ? (details.created_by?.[0]?.name ?? null)
      : (details.credits?.crew?.find((member: any) => member.job === DIRECTOR_JOB)?.name ?? null);
    const cast = (details.credits?.cast ?? []).slice(0, MAX_CAST_MEMBERS).map((member: any) => member.name);
    const releaseDate = isTv ? details.first_air_date : details.release_date;
    const runtime = isTv ? (details.episode_run_time?.[0] ?? null) : (details.runtime ?? null);
    const country = isTv
      ? (details.origin_country?.[0] ?? null)
      : (details.production_countries?.[0]?.iso_3166_1 ?? null);

    return {
      tmdbId: details.id,
      tmdbType: ref.tmdbType,
      title: (isTv ? details.name : details.title) || fallbackTitle,
      originalTitle: (isTv ? details.original_name : details.original_title) ?? null,
      year: releaseDate ? Number(releaseDate.slice(0, 4)) : fallbackYear,
      posterUrl: details.poster_path ? TMDB_IMAGE_URL + details.poster_path : null,
      director,
      cast: cast.length ? cast : null,
      runtime,
      genres: (details.genres ?? []).map((genre: any) => genre.name),
      overview: details.overview || null,
      tmdbRating: details.vote_average ?? null,
      country,
      enriched: true,
    };
  } catch {
    return null;
  }
}
