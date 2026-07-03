export interface SessionFilters {
  maxRuntime: number | null;
  excludeGenres: string[];
}

export function collectGenres(movies: { genres: string[] | null }[]): string[] {
  const genres = new Set<string>();
  for (const movie of movies) for (const genre of movie.genres ?? []) genres.add(genre);
  return [...genres].sort();
}
