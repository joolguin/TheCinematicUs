export interface SessionFilters {
  maxRuntime: number | null;
  excludeGenres: string[];
}

interface Filterable {
  runtime: number | null;
  genres: string[] | null;
}

export function applyFilters<T extends Filterable>(movies: T[], filters: SessionFilters | null): T[] {
  if (!filters) return movies;
  const maxRuntime = filters.maxRuntime ?? null;
  const exclude = new Set(filters.excludeGenres ?? []);
  return movies.filter((movie) => {
    if (maxRuntime != null && movie.runtime != null && movie.runtime > maxRuntime) return false;
    if (exclude.size > 0 && movie.genres && movie.genres.some((genre) => exclude.has(genre))) return false;
    return true;
  });
}

export function collectGenres(movies: { genres: string[] | null }[]): string[] {
  const genres = new Set<string>();
  for (const movie of movies) for (const genre of movie.genres ?? []) genres.add(genre);
  return [...genres].sort();
}
