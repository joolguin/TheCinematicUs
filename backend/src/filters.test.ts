import { describe, it, expect } from 'vitest';
import { applyFilters, collectGenres, type SessionFilters } from './filters.js';

const M = (over: Partial<{ id: string; runtime: number | null; genres: string[] | null }>) => ({
  id: 'x', runtime: null, genres: null, ...over,
});

describe('applyFilters', () => {
  const pool = [
    M({ id: 'corta', runtime: 80, genres: ['Comedy'] }),
    M({ id: 'larga', runtime: 180, genres: ['Drama'] }),
    M({ id: 'terror', runtime: 95, genres: ['Horror', 'Thriller'] }),
    M({ id: 'sinRuntime', runtime: null, genres: ['Drama'] }),
    M({ id: 'sinGenres', runtime: 100, genres: null }),
  ];

  it('sin filtro (null) es passthrough', () => {
    expect(applyFilters(pool, null)).toEqual(pool);
  });

  it('maxRuntime mantiene cortas y las de runtime desconocido, saca largas', () => {
    const r = applyFilters(pool, { maxRuntime: 120, excludeGenres: [] }).map((m) => m.id);
    expect(r).toEqual(['corta', 'terror', 'sinRuntime', 'sinGenres']); // 'larga' (180) fuera
  });

  it('excludeGenres saca las que tienen un género excluido, mantiene genres null', () => {
    const r = applyFilters(pool, { maxRuntime: null, excludeGenres: ['Horror'] }).map((m) => m.id);
    expect(r).toEqual(['corta', 'larga', 'sinRuntime', 'sinGenres']); // 'terror' fuera
  });

  it('combina runtime y géneros', () => {
    const r = applyFilters(pool, { maxRuntime: 120, excludeGenres: ['Drama'] }).map((m) => m.id);
    // fuera: 'larga' (180 y Drama), 'sinRuntime' (Drama). queda corta, terror, sinGenres
    expect(r).toEqual(['corta', 'terror', 'sinGenres']);
  });

  it('maxRuntime null + excludeGenres vacío es passthrough', () => {
    expect(applyFilters(pool, { maxRuntime: null, excludeGenres: [] })).toEqual(pool);
  });

  it('tolera campos faltantes en filters (tratados como sin efecto)', () => {
    expect(applyFilters(pool, {} as SessionFilters)).toEqual(pool);
  });
});

describe('collectGenres', () => {
  it('devuelve unión ordenada y deduplicada, ignora genres null', () => {
    const r = collectGenres([
      { genres: ['Drama', 'Comedy'] },
      { genres: ['Comedy', 'Horror'] },
      { genres: null },
    ]);
    expect(r).toEqual(['Comedy', 'Drama', 'Horror']);
  });

  it('pool vacío → []', () => {
    expect(collectGenres([])).toEqual([]);
  });
});
