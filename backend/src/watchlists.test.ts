// backend/src/watchlists.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let scrapeResult: any;        // valor que devuelve scrapeWatchlist (o un Error a lanzar)
const deleteMock = vi.fn();
const insertMock = vi.fn();

vi.mock('./letterboxd.js', () => ({
  scrapeWatchlist: vi.fn(() =>
    scrapeResult instanceof Error ? Promise.reject(scrapeResult) : Promise.resolve(scrapeResult),
  ),
}));

vi.mock('./movies.js', () => ({
  // resuelve cada título a un id determinístico
  resolveMovie: vi.fn((title: string) => Promise.resolve({ id: `id-${title}` })),
}));

vi.mock('./db.js', () => ({
  supabase: {
    from: () => ({
      delete: () => { deleteMock(); return { eq: () => Promise.resolve({ error: null }) }; },
      insert: (...a: any[]) => { insertMock(...a); return Promise.resolve({ error: null }); },
    }),
  },
}));

import { refreshWatchlistForUser } from './watchlists.js';

beforeEach(() => {
  scrapeResult = [];
  deleteMock.mockClear();
  insertMock.mockClear();
});

describe('refreshWatchlistForUser', () => {
  it('reemplaza el set cuando el scrape trae films', async () => {
    scrapeResult = [
      { title: 'Drive', year: 2011 },
      { title: 'Her', year: 2013 },
      { title: 'Drive', year: 2011 }, // duplicado
    ];
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 2, ok: true });
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith([
      { user_id: 'u1', movie_id: 'id-Drive' },
      { user_id: 'u1', movie_id: 'id-Her' },
    ]);
  });

  it('mantiene el set anterior si el scrape viene vacío', async () => {
    scrapeResult = [];
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 0, ok: false, error: 'scrape vacío' });
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('mantiene el set anterior si el scrape falla', async () => {
    scrapeResult = new Error('timeout');
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 0, ok: false, error: 'timeout' });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('falla si la usuaria no tiene URL', async () => {
    const r = await refreshWatchlistForUser('u1', null);
    expect(r.ok).toBe(false);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
