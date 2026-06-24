// backend/src/movies.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Estado de los mocks (se resetea en beforeEach).
let rows: Record<string, { id: string } | null>; // filas por `${col}:${val}`
let insertResult: { data: any; error: any };
let enrich: any;

vi.mock('./tmdb.js', () => ({
  searchAndEnrich: vi.fn(() => Promise.resolve(enrich)),
}));

vi.mock('./db.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (col: string, val: any) => {
          const data = rows[`${col}:${val}`] ?? null;
          return {
            maybeSingle: () => Promise.resolve({ data }),
            single: () => Promise.resolve({ data }),
          };
        },
      }),
      insert: () => ({ select: () => ({ single: () => Promise.resolve(insertResult) }) }),
    }),
  },
}));

import { normalizeKey, resolveMovie } from './movies.js';

describe('normalizeKey', () => {
  it('genera clave estable título+año', () => {
    expect(normalizeKey('Parasite', 2019)).toBe('parasite|2019');
  });
  it('clave sin año', () => {
    expect(normalizeKey('Amelie', null)).toBe('amelie|');
  });
  it('normaliza mayúsculas y espacios', () => {
    expect(normalizeKey('  DRIVE ', 2011)).toBe('drive|2011');
  });
});

describe('resolveMovie', () => {
  beforeEach(() => {
    rows = {};
    insertResult = { data: { id: 'nuevo' }, error: null };
    enrich = { tmdbId: 500, title: 'X', originalTitle: null, year: 2000, posterUrl: null,
      director: null, cast: null, runtime: null, genres: null, overview: null,
      tmdbRating: null, country: null, enriched: true };
  });

  it('devuelve la cacheada sin insertar', async () => {
    rows['search_key:x|2000'] = { id: 'cacheada' };
    expect(await resolveMovie('X', 2000)).toEqual({ id: 'cacheada' });
  });

  it('inserta y devuelve el id nuevo', async () => {
    expect(await resolveMovie('X', 2000)).toEqual({ id: 'nuevo' });
  });

  it('ante conflicto por tmdb_id re-lee por tmdb_id (no por search_key)', async () => {
    // El insert falla porque ya existe una peli con ese tmdb_id bajo OTRA search_key.
    insertResult = { data: null, error: { code: '23505', message: 'movies_tmdb_id_key' } };
    rows['tmdb_id:500'] = { id: 'existente' };
    // search_key NO tiene fila (la existente entró con otra clave)
    expect(await resolveMovie('X', 2000)).toEqual({ id: 'existente' });
  });

  it('ante conflicto por search_key (carrera) re-lee por search_key', async () => {
    insertResult = { data: null, error: { code: '23505', message: 'movies_search_key_key' } };
    enrich.tmdbId = null; // sin tmdb_id no hay colisión por tmdb_id
    rows['search_key:x|2000'] = { id: 'ganadora' };
    expect(await resolveMovie('X', 2000)).toEqual({ id: 'ganadora' });
  });

  it('si el insert falla y no aparece ninguna fila, propaga el error real (no null.id)', async () => {
    insertResult = { data: null, error: { code: '23502', message: 'null value in column' } };
    await expect(resolveMovie('X', 2000)).rejects.toMatchObject({ code: '23502' });
  });
});
