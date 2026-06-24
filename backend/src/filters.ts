// backend/src/filters.ts
// Lógica pura de filtrado del mazo. Sin dependencias de Supabase: recibe arrays,
// devuelve arrays. Es el único lugar con riesgo de bug (nulls, exclusión), por eso
// vive en el backend (donde hay tests) y no en el frontend.

export interface SessionFilters {
  maxRuntime: number | null; // minutos; null = sin límite
  excludeGenres: string[];   // géneros a excluir; [] = sin exclusión
}

interface Filterable {
  runtime: number | null;
  genres: string[] | null;
}

export function applyFilters<T extends Filterable>(movies: T[], filters: SessionFilters | null): T[] {
  if (!filters) return movies;
  const maxRuntime = filters.maxRuntime ?? null;
  const exclude = new Set(filters.excludeGenres ?? []);
  return movies.filter((m) => {
    // Duración: desconocida (null) no se esconde.
    if (maxRuntime != null && m.runtime != null && m.runtime > maxRuntime) return false;
    // Géneros excluidos: genres null pasa (no se puede excluir lo que no se conoce).
    if (exclude.size > 0 && m.genres && m.genres.some((g) => exclude.has(g))) return false;
    return true;
  });
}

export function collectGenres(movies: { genres: string[] | null }[]): string[] {
  const set = new Set<string>();
  for (const m of movies) for (const g of m.genres ?? []) set.add(g);
  return [...set].sort();
}
