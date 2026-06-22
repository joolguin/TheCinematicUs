// backend/src/tmdb.ts
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

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w500';

// Parsea una línea "Título (Año)". El año es opcional.
export function parseTitleLine(line: string): { title: string; year: number | null } {
  const trimmed = line.trim();
  const m = trimmed.match(/^(.*?)\s*\((\d{4})\)\s*$/);
  if (m) return { title: m[1].trim(), year: Number(m[2]) };
  return { title: trimmed, year: null };
}

async function tmdbGet(path: string, params: Record<string, string>) {
  const url = new URL(BASE + path);
  url.searchParams.set('api_key', config.tmdbApiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

// Busca una peli y la enriquece. Si no hay match, devuelve datos mínimos con enriched=false.
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

    // append_to_response=credits trae director y cast en una sola llamada
    const d = await tmdbGet(`/movie/${hit.id}`, { append_to_response: 'credits' });
    const director = d.credits?.crew?.find((c: any) => c.job === 'Director')?.name ?? null;
    const cast = (d.credits?.cast ?? []).slice(0, 5).map((c: any) => c.name);
    return {
      tmdbId: d.id,
      title: d.title,
      originalTitle: d.original_title ?? null,
      year: d.release_date ? Number(d.release_date.slice(0, 4)) : year,
      posterUrl: d.poster_path ? IMG + d.poster_path : null,
      director,
      cast: cast.length ? cast : null,
      runtime: d.runtime ?? null,
      genres: (d.genres ?? []).map((g: any) => g.name),
      overview: d.overview || null,
      tmdbRating: d.vote_average ?? null,
      country: d.production_countries?.[0]?.iso_3166_1 ?? null,
      enriched: true,
    };
  } catch {
    // Rate limit / caída: devolvemos datos mínimos, el import no se corta.
    return minimal;
  }
}
