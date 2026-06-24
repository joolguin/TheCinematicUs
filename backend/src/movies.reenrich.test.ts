import { describe, it, expect, vi, beforeEach } from 'vitest';

let staleRows: any[] = [];
const updateMock = vi.fn();
let enrich: any;

vi.mock('./tmdb.js', () => ({
  searchAndEnrich: vi.fn(() => Promise.resolve(enrich)),
}));

vi.mock('./db.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ or: () => Promise.resolve({ data: staleRows }) }) }),
      update: (payload: any) => { updateMock(payload); return { eq: () => Promise.resolve({ error: null }) }; },
    }),
  },
}));

import { reEnrichStale } from './movies.js';

beforeEach(() => {
  staleRows = [];
  updateMock.mockClear();
  enrich = { tmdbId: 99, title: 'Resuelta', originalTitle: null, year: 2001, posterUrl: null,
    director: null, cast: null, runtime: null, genres: null, overview: null,
    tmdbRating: null, country: null, enriched: true };
});

describe('reEnrichStale', () => {
  it('reintenta las pelis no enriquecidas y cuenta las que se enriquecieron', async () => {
    staleRows = [{ id: 'm1', title: 'X', year: 2001 }];
    const r = await reEnrichStale(new Date('2026-06-24T00:00:00Z'));
    expect(r).toEqual({ attempted: 1, enriched: 1 });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0]).toMatchObject({
      enriched: true,
      fetched_at: '2026-06-24T00:00:00.000Z',
      last_enrich_attempt_at: '2026-06-24T00:00:00.000Z',
    });
  });

  it('no cuenta como enriquecida si TMDB sigue sin match (fetched_at queda null)', async () => {
    staleRows = [{ id: 'm1', title: 'X', year: 2001 }];
    enrich.enriched = false;
    const r = await reEnrichStale(new Date('2026-06-24T00:00:00Z'));
    expect(r).toEqual({ attempted: 1, enriched: 0 });
    expect(updateMock.mock.calls[0][0]).toMatchObject({
      enriched: false,
      fetched_at: null,
      last_enrich_attempt_at: '2026-06-24T00:00:00.000Z',
    });
  });

  it('no hace nada si no hay pelis stale', async () => {
    staleRows = [];
    const r = await reEnrichStale(new Date('2026-06-24T00:00:00Z'));
    expect(r).toEqual({ attempted: 0, enriched: 0 });
    expect(updateMock).not.toHaveBeenCalled();
  });
});
