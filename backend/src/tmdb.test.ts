import { describe, it, expect } from 'vitest';
import { parseTitleLine } from './tmdb.js';

describe('parseTitleLine', () => {
  it('separa título y año', () => {
    expect(parseTitleLine('Parasite (2019)')).toEqual({ title: 'Parasite', year: 2019 });
  });
  it('título sin año', () => {
    expect(parseTitleLine('Amelie')).toEqual({ title: 'Amelie', year: null });
  });
  it('recorta espacios', () => {
    expect(parseTitleLine('  Drive (2011)  ')).toEqual({ title: 'Drive', year: 2011 });
  });
  it('ignora líneas vacías devolviendo título vacío', () => {
    expect(parseTitleLine('   ')).toEqual({ title: '', year: null });
  });
});
