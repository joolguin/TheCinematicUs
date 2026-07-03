import { describe, it, expect, vi, beforeEach } from 'vitest';

let claimData: any[];
let refreshResult: any;
let reenrichResult: any;
let refreshThrows = false;
let reenrichThrows = false;
const updateMock = vi.fn();

vi.mock('./watchlists.js', () => ({
  refreshAllWatchlists: vi.fn(() =>
    refreshThrows ? Promise.reject(new Error('scrape down')) : Promise.resolve(refreshResult)),
}));
vi.mock('./movies.js', () => ({
  reEnrichStale: vi.fn(() =>
    reenrichThrows ? Promise.reject(new Error('tmdb down')) : Promise.resolve(reenrichResult)),
}));

vi.mock('./db.js', () => ({
  supabase: {
    from: () => ({
      update: (payload: any) => {
        updateMock(payload);
        const eqResult: any = {
          or: () => ({ select: () => Promise.resolve({ data: claimData }) }),
          then: (onF: any, onR: any) => Promise.resolve({ error: null }).then(onF, onR),
        };
        return { eq: () => eqResult };
      },
    }),
  },
}));

import { claimRefresh, runRefreshJob } from './refreshJob.js';

beforeEach(() => {
  claimData = [{ id: 1 }];
  refreshResult = { Jo: { count: 5, ok: true } };
  reenrichResult = { attempted: 2, enriched: 1 };
  refreshThrows = false;
  reenrichThrows = false;
  updateMock.mockClear();
});

describe('claimRefresh', () => {
  it('devuelve true cuando el update condicional afecta la fila', async () => {
    claimData = [{ id: 1 }];
    expect(await claimRefresh()).toBe(true);
  });
  it('devuelve false cuando ya hay un refresh corriendo (no afecta filas)', async () => {
    claimData = [];
    expect(await claimRefresh()).toBe(false);
  });
});

describe('runRefreshJob', () => {
  it('escribe status=done con conteos + reenriched', async () => {
    await runRefreshJob();
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0]).toMatchObject({
      status: 'done',
      result: { Jo: { count: 5, ok: true }, reenriched: { attempted: 2, enriched: 1 } },
    });
  });
  it('escribe status=error si el refresh falla', async () => {
    refreshThrows = true;
    await runRefreshJob();
    expect(updateMock.mock.calls[0][0]).toMatchObject({ status: 'error', result: { error: 'scrape down' } });
  });
  it('escribe status=error si el reEnrich falla', async () => {
    reenrichThrows = true;
    await runRefreshJob();
    expect(updateMock.mock.calls[0][0]).toMatchObject({ status: 'error', result: { error: 'tmdb down' } });
  });
});
