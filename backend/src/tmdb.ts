import { config } from './config.js';

export interface MovieData {
  tmdbId: number | null;
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

export async function searchAndEnrich(title: string, year: number | null): Promise<MovieData> {
  const minimal: MovieData = {
    tmdbId: null, title, originalTitle: null, year, posterUrl: null,
    director: null, cast: null, runtime: null, genres: null,
    overview: null, tmdbRating: null, country: null, enriched: false,
  };
  try {
    const params: Record<string, string> = { query: title };
    if (year) params.year = String(year);
    const search = await tmdbGet('/search/movie', params);
    const hit = search.results?.[0];
    if (!hit) return minimal;

    const details = await tmdbGet(`/movie/${hit.id}`, { append_to_response: 'credits' });
    const director = details.credits?.crew?.find((member: any) => member.job === DIRECTOR_JOB)?.name ?? null;
    const cast = (details.credits?.cast ?? []).slice(0, MAX_CAST_MEMBERS).map((member: any) => member.name);
    return {
      tmdbId: details.id,
      title: details.title,
      originalTitle: details.original_title ?? null,
      year: details.release_date ? Number(details.release_date.slice(0, 4)) : year,
      posterUrl: details.poster_path ? TMDB_IMAGE_URL + details.poster_path : null,
      director,
      cast: cast.length ? cast : null,
      runtime: details.runtime ?? null,
      genres: (details.genres ?? []).map((genre: any) => genre.name),
      overview: details.overview || null,
      tmdbRating: details.vote_average ?? null,
      country: details.production_countries?.[0]?.iso_3166_1 ?? null,
      enriched: true,
    };
  } catch {
    return minimal;
  }
}
