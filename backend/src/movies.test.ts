// backend/src/movies.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeKey } from './movies.js';

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
