import { describe, it, expect, vi, beforeEach } from 'vitest';

let staleRows: any[] = [];
let links: any[] = [];
let details: any;
let ref: any;

const movieUpdateMock = vi.fn();
const linkUpdateMock = vi.fn();
const fetchRefMock = vi.fn(() => Promise.resolve(ref));

vi.mock('./tmdb.js', () => ({
  fetchById: vi.fn(() => Promise.resolve(details)),
}));

vi.mock('./letterboxd.js', () => ({
  fetchFilmTmdbRef: (slug: string) => fetchRefMock(slug as any),
}));

vi.mock('./db.js', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ or: () => Promise.resolve({ data: staleRows }) }),
        in: () => Promise.resolve({ data: links }),
      }),
      update: (payload: any) => {
        if (table === 'movies') movieUpdateMock(payload);
        else linkUpdateMock(payload);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  },
}));

import { reEnrichStale } from './movies.js';

const NOW = new Date('2026-08-16T00:00:00Z');
const STAMP = '2026-08-16T00:00:00.000Z';

beforeEach(() => {
  staleRows = [];
  links = [];
  ref = { tmdbId: 99, tmdbType: 'movie' };
  details = {
    tmdbId: 99, tmdbType: 'movie', title: 'Resuelta', originalTitle: null, year: 2001,
    posterUrl: null, director: null, cast: null, runtime: null, genres: null,
    overview: null, tmdbRating: null, country: null, enriched: true,
  };
  movieUpdateMock.mockClear();
  linkUpdateMock.mockClear();
  fetchRefMock.mockClear();
});

describe('reEnrichStale', () => {
  it('re-lee la página del film y enriquece la fila legacy', async () => {
    staleRows = [{ id: 'm1', title: 'X', year: 2001 }];
    links = [{ slug: 'x', tmdb_id: 99, tmdb_type: 'movie', movie_id: 'm1' }];

    const r = await reEnrichStale(NOW);

    expect(r).toEqual({ attempted: 1, enriched: 1 });
    // Re-lee aunque tenga tmdb_id cacheado: puede haber cambiado del lado de Letterboxd.
    expect(fetchRefMock).toHaveBeenCalledWith('x');
    expect(movieUpdateMock.mock.calls[0][0]).toMatchObject({
      enriched: true, fetched_at: STAMP, last_enrich_attempt_at: STAMP,
    });
    expect(linkUpdateMock.mock.calls[0][0]).toMatchObject({ tmdb_id: 99, resolved_at: STAMP });
  });

  it('si la página sigue sin data-tmdb-id, solo corre el backoff (no escribe datos vacíos)', async () => {
    staleRows = [{ id: 'm1', title: 'X', year: 2001 }];
    links = [{ slug: 'x', tmdb_id: null, tmdb_type: null, movie_id: 'm1' }];
    ref = null;

    const r = await reEnrichStale(NOW);

    expect(r).toEqual({ attempted: 1, enriched: 0 });
    expect(movieUpdateMock.mock.calls[0][0]).toEqual({ last_enrich_attempt_at: STAMP });
    expect(linkUpdateMock).not.toHaveBeenCalled();
  });

  it('si el ID de Letterboxd está muerto en TMDB, solo corre el backoff', async () => {
    staleRows = [{ id: 'm1', title: 'X', year: 2001 }];
    links = [{ slug: 'x', tmdb_id: 99, tmdb_type: 'movie', movie_id: 'm1' }];
    details = null; // fetchById devuelve null ante el 404 de TMDB

    const r = await reEnrichStale(NOW);

    expect(r).toEqual({ attempted: 1, enriched: 0 });
    expect(movieUpdateMock.mock.calls[0][0]).toEqual({ last_enrich_attempt_at: STAMP });
  });

  it('peli sin slug asociado (fila legacy): solo corre el backoff, no reintenta', async () => {
    staleRows = [{ id: 'huerfana', title: 'X', year: 2001 }];
    links = [];

    const r = await reEnrichStale(NOW);

    expect(r).toEqual({ attempted: 1, enriched: 0 });
    expect(fetchRefMock).not.toHaveBeenCalled();
    expect(movieUpdateMock.mock.calls[0][0]).toEqual({ last_enrich_attempt_at: STAMP });
  });

  it('no hace nada si no hay pelis stale', async () => {
    const r = await reEnrichStale(NOW);
    expect(r).toEqual({ attempted: 0, enriched: 0 });
    expect(movieUpdateMock).not.toHaveBeenCalled();
  });
});
