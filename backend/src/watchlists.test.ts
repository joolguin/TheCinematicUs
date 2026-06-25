// backend/src/watchlists.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let scrapeResult: any;        // valor que devuelve scrapeWatchlist (o un Error a lanzar)
const deleteMock = vi.fn();   // ids pasados a .delete().eq().in(ids)
const insertMock = vi.fn();   // filas pasadas a .insert(rows)
let deleteError: any = null;
let insertError: any = null;
let currentItems: { movie_id: string }[] = [];

vi.mock('./letterboxd.js', () => ({
  scrapeWatchlist: vi.fn(() =>
    scrapeResult instanceof Error ? Promise.reject(scrapeResult) : Promise.resolve(scrapeResult),
  ),
}));

vi.mock('./movies.js', () => ({
  resolveMovie: vi.fn((title: string) => Promise.resolve({ id: `id-${title}` })),
}));

vi.mock('./db.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => Promise.resolve({ data: currentItems }) }),
      delete: () => ({
        eq: () => ({
          in: (_col: string, ids: string[]) => { deleteMock(ids); return Promise.resolve({ error: deleteError }); },
        }),
      }),
      insert: (rows: any[]) => { insertMock(rows); return Promise.resolve({ error: insertError }); },
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
  it('primer load (sin set previo): inserta todas con first_seen_at, no borra', async () => {
    scrapeResult = [{ title: 'Drive', year: 2011 }, { title: 'Her', year: 2013 }, { title: 'Drive', year: 2011 }];
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 2, ok: true });
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith([
      { user_id: 'u1', movie_id: 'id-Drive', first_seen_at: expect.any(String) },
      { user_id: 'u1', movie_id: 'id-Her', first_seen_at: expect.any(String) },
    ]);
  });

  it('altas y bajas: inserta solo las nuevas, no re-inserta las que siguen, borra las que faltan', async () => {
    currentItems = [{ movie_id: 'id-A' }, { movie_id: 'id-B' }, { movie_id: 'id-C' }, { movie_id: 'id-D' }, { movie_id: 'id-E' }];
    scrapeResult = [{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' }, { title: 'New' }];
    // se va id-E (1 de 5 = 20% ≤ 40%) → procede; nueva = id-New
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 5, ok: true });
    expect(deleteMock).toHaveBeenCalledWith(['id-E']);
    expect(insertMock).toHaveBeenCalledWith([
      { user_id: 'u1', movie_id: 'id-New', first_seen_at: expect.any(String) },
    ]);
  });

  it('solo altas (nada se va): inserta las nuevas, no borra', async () => {
    currentItems = [{ movie_id: 'id-A' }];
    scrapeResult = [{ title: 'A' }, { title: 'B' }];
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 2, ok: true });
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith([
      { user_id: 'u1', movie_id: 'id-B', first_seen_at: expect.any(String) },
    ]);
  });

  it('mantiene el set anterior si el scrape eliminaría >40% del pozo', async () => {
    currentItems = Array.from({ length: 10 }, (_, i) => ({ movie_id: `id-old${i}` }));
    scrapeResult = [{ title: 'old0' }, { title: 'old1' }]; // se irían 8 (80%)
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r.ok).toBe(false);
    expect(r.kept).toBe(true);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
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
    scrapeResult = [{ title: 'Drive', year: 2011 }, { title: 'Her', year: 2013 }];
    const { resolveMovie } = await import('./movies.js');
    (resolveMovie as any).mockRejectedValueOnce(new Error('tmdb down'));
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('tmdb down');
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('falla si el delete da error (hay bajas)', async () => {
    currentItems = [{ movie_id: 'id-A' }, { movie_id: 'id-B' }, { movie_id: 'id-C' }, { movie_id: 'id-D' }, { movie_id: 'id-E' }];
    scrapeResult = [{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' }]; // se va id-E (20%)
    deleteError = { message: 'db connection lost' };
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 0, ok: false, error: 'db connection lost' });
    expect(deleteMock).toHaveBeenCalledWith(['id-E']);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('falla si el insert da error (hay altas)', async () => {
    currentItems = [{ movie_id: 'id-A' }];
    scrapeResult = [{ title: 'A' }, { title: 'B' }];
    insertError = { message: 'constraint violation' };
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 0, ok: false, error: 'constraint violation' });
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
