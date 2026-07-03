import { API_URL } from './config';

export interface Movie {
  id: string;
  tmdb_id: number | null;
  title: string;
  original_title: string | null;
  year: number | null;
  poster_url: string | null;
  director: string | null;
  cast: string[] | null;
  runtime: number | null;
  genres: string[] | null;
  overview: string | null;
  tmdb_rating: number | null;
  country: string | null;
  enriched: boolean;
}

export interface SessionFilters {
  maxRuntime: number | null;
  excludeGenres: string[];
}

export interface DeckResponse {
  deck: Movie[];
  genres: string[];
  filters: SessionFilters | null;
}

function headers() {
  return {
    'Content-Type': 'application/json',
    'x-passphrase': localStorage.getItem('passphrase') ?? '',
  };
}

export const api = {
  async get(path: string) {
    const res = await fetch(API_URL + path, { headers: headers() });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  },
  async post(path: string, body: unknown) {
    const res = await fetch(API_URL + path, {
      method: 'POST', headers: headers(), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  },
};
