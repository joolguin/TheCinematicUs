import { describe, it, expect } from 'vitest';
import { collectGenres } from './filters.js';

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
