// backend/src/watchlists.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let scrapeResult: any;        // valor que devuelve scrapeWatchlist (o un Error a lanzar)
const deleteMock = vi.fn();
const insertMock = vi.fn();
let deleteError: any = null;
let insertError: any = null;
let currentItems: { movie_id: string }[] = [];

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
      select: () => ({ eq: () => Promise.resolve({ data: currentItems }) }),
      delete: () => { deleteMock(); return { eq: () => Promise.resolve({ error: deleteError }) }; },
      insert: (...a: any[]) => { insertMock(...a); return Promise.resolve({ error: insertError }); },
    }),
  },
}));

import { refreshWatchlistForUser } from './watchlists.js';

beforeEach(() => {
  scrapeResult = [];
  deleteMock.mockClear();
  insertMock.mockClear();
  deleteError = null;
  insertError = null;
  currentItems = [];
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
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('falla si la usuaria no tiene URL', async () => {
    const r = await refreshWatchlistForUser('u1', null);
    expect(r.ok).toBe(false);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('mantiene el set anterior si resolveMovie falla', async () => {
    scrapeResult = [
      { title: 'Drive', year: 2011 },
      { title: 'Her', year: 2013 },
    ];
    const { resolveMovie } = await import('./movies.js');
    (resolveMovie as any).mockRejectedValueOnce(new Error('tmdb down'));
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('tmdb down');
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('falla sin vaciar el pozo cuando el delete da error', async () => {
    scrapeResult = [{ title: 'Drive', year: 2011 }];
    deleteError = { message: 'db connection lost' };
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 0, ok: false, error: 'db connection lost' });
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('falla cuando el insert da error (delete ya ejecutado)', async () => {
    scrapeResult = [{ title: 'Drive', year: 2011 }];
    insertError = { message: 'constraint violation' };
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 0, ok: false, error: 'constraint violation' });
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it('mantiene el set anterior si el scrape eliminaría >40% del pozo', async () => {
    // pozo actual de 10; el scrape trae solo 2 conocidas → se irían 8 (80%)
    currentItems = Array.from({ length: 10 }, (_, i) => ({ movie_id: `id-old${i}` }));
    scrapeResult = [
      { title: 'old0', year: 2000 }, // resolveMovie mock → id-old0
      { title: 'old1', year: 2000 }, // → id-old1
    ];
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r.ok).toBe(false);
    expect(r.kept).toBe(true);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('reemplaza si el diff está dentro del umbral', async () => {
    currentItems = [{ movie_id: 'id-Drive' }, { movie_id: 'id-Her' }, { movie_id: 'id-old' }];
    scrapeResult = [{ title: 'Drive', year: 2011 }, { title: 'Her', year: 2013 }];
    // se va 1 de 3 = 33% < 40% → procede
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r.ok).toBe(true);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});
