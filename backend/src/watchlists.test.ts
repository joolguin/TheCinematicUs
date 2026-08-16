import { describe, it, expect, vi, beforeEach } from 'vitest';

let scrapeResult: any;
const deleteMock = vi.fn();
const insertMock = vi.fn();
let deleteError: any = null;
let insertError: any = null;
let currentItems: { movie_id: string }[] = [];
let unresolvable = new Set<string>();

vi.mock('./letterboxd.js', () => ({
  scrapeWatchlist: vi.fn(() =>
    scrapeResult instanceof Error ? Promise.reject(scrapeResult) : Promise.resolve(scrapeResult),
  ),
}));

vi.mock('./movies.js', () => ({
  resolveMovie: vi.fn((film: { slug: string }) =>
    Promise.resolve(unresolvable.has(film.slug) ? null : { id: `id-${film.slug}` }),
  ),
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
  unresolvable = new Set();
});

describe('refreshWatchlistForUser', () => {
  it('primer load (sin set previo): inserta todas con first_seen_at, no borra', async () => {
    scrapeResult = [{ slug: 'Drive', title: 'Drive', year: 2011 }, { slug: 'Her', title: 'Her', year: 2013 }, { slug: 'Drive', title: 'Drive', year: 2011 }];
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
    scrapeResult = [{ slug: 'A', title: 'A' }, { slug: 'B', title: 'B' }, { slug: 'C', title: 'C' }, { slug: 'D', title: 'D' }, { slug: 'New', title: 'New' }];

    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 5, ok: true });
    expect(deleteMock).toHaveBeenCalledWith(['id-E']);
    expect(insertMock).toHaveBeenCalledWith([
      { user_id: 'u1', movie_id: 'id-New', first_seen_at: expect.any(String) },
    ]);
  });

  it('solo altas (nada se va): inserta las nuevas, no borra', async () => {
    currentItems = [{ movie_id: 'id-A' }];
    scrapeResult = [{ slug: 'A', title: 'A' }, { slug: 'B', title: 'B' }];
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 2, ok: true });
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith([
      { user_id: 'u1', movie_id: 'id-B', first_seen_at: expect.any(String) },
    ]);
  });

  it('mantiene el set anterior si el scrape eliminaría >40% del pozo', async () => {
    currentItems = Array.from({ length: 10 }, (_, i) => ({ movie_id: `id-old${i}` }));
    scrapeResult = [{ slug: 'old0', title: 'old0' }, { slug: 'old1', title: 'old1' }];
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

  it('las que no resuelven a TMDB quedan fuera del pozo y se reportan', async () => {
    scrapeResult = [{ slug: 'A', title: 'A' }, { slug: 'muerta', title: 'Muerta' }, { slug: 'B', title: 'B' }];
    unresolvable = new Set(['muerta']);

    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');

    expect(r).toEqual({ count: 2, ok: true, unresolved: 1 });
    expect(insertMock).toHaveBeenCalledWith([
      { user_id: 'u1', movie_id: 'id-A', first_seen_at: expect.any(String) },
      { user_id: 'u1', movie_id: 'id-B', first_seen_at: expect.any(String) },
    ]);
  });

  it('no reporta unresolved cuando resolvieron todas', async () => {
    scrapeResult = [{ slug: 'A', title: 'A' }];
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 1, ok: true });
  });

  it('mantiene el set anterior si NINGUNA resuelve (fallo masivo de TMDB)', async () => {
    currentItems = [{ movie_id: 'id-A' }, { movie_id: 'id-B' }];
    scrapeResult = [{ slug: 'A', title: 'A' }, { slug: 'B', title: 'B' }];
    unresolvable = new Set(['A', 'B']);

    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');

    expect(r.ok).toBe(false);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('el guard de diff frena si demasiadas dejan de resolver', async () => {
    currentItems = Array.from({ length: 10 }, (_, i) => ({ movie_id: `id-old${i}` }));
    scrapeResult = Array.from({ length: 10 }, (_, i) => ({ slug: `old${i}`, title: `old${i}` }));
    unresolvable = new Set(['old2', 'old3', 'old4', 'old5', 'old6']);

    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');

    expect(r.kept).toBe(true);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('mantiene el set anterior si resolveMovie falla', async () => {
    scrapeResult = [{ slug: 'Drive', title: 'Drive', year: 2011 }, { slug: 'Her', title: 'Her', year: 2013 }];
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
    scrapeResult = [{ slug: 'A', title: 'A' }, { slug: 'B', title: 'B' }, { slug: 'C', title: 'C' }, { slug: 'D', title: 'D' }];
    deleteError = { message: 'db connection lost' };
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 0, ok: false, error: 'db connection lost' });
    expect(deleteMock).toHaveBeenCalledWith(['id-E']);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('falla si el insert da error (hay altas)', async () => {
    currentItems = [{ movie_id: 'id-A' }];
    scrapeResult = [{ slug: 'A', title: 'A' }, { slug: 'B', title: 'B' }];
    insertError = { message: 'constraint violation' };
    const r = await refreshWatchlistForUser('u1', 'https://letterboxd.com/jo/watchlist/');
    expect(r).toEqual({ count: 0, ok: false, error: 'constraint violation' });
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
