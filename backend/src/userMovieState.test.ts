import { describe, it, expect, vi, beforeEach } from 'vitest';

let existingRow: any;     // fila leída por recordMovieState (maybeSingle)
let statesRows: any[];    // filas devueltas por getMovieStates (.in)
const upsertMock = vi.fn();

vi.mock('./db.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          // recordMovieState: .eq('user_id').eq('movie_id').maybeSingle()
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: existingRow }) }),
          // getMovieStates: .eq('user_id').in('movie_id', ids)
          in: () => Promise.resolve({ data: statesRows }),
        }),
      }),
      upsert: (payload: any) => { upsertMock(payload); return Promise.resolve({ error: null }); },
    }),
  },
}));

import { recordMovieState, getMovieStates, orderByNovelty } from './userMovieState.js';

beforeEach(() => {
  existingRow = null;
  statesRows = [];
  upsertMock.mockClear();
});

describe('recordMovieState', () => {
  it('pass en fila nueva: pass_count=1, last_passed_at seteado, last_liked_at null', async () => {
    existingRow = null;
    await recordMovieState('u1', 'm1', false);
    expect(upsertMock.mock.calls[0][0]).toMatchObject({
      user_id: 'u1', movie_id: 'm1', pass_count: 1, last_liked_at: null,
      last_passed_at: expect.any(String),
    });
  });

  it('pass en fila existente: incrementa pass_count y preserva last_liked_at', async () => {
    existingRow = { pass_count: 2, last_passed_at: '2026-01-01T00:00:00.000Z', last_liked_at: '2026-02-02T00:00:00.000Z' };
    await recordMovieState('u1', 'm1', false);
    expect(upsertMock.mock.calls[0][0]).toMatchObject({
      pass_count: 3, last_liked_at: '2026-02-02T00:00:00.000Z', last_passed_at: expect.any(String),
    });
  });

  it('like: setea last_liked_at y preserva pass_count + last_passed_at', async () => {
    existingRow = { pass_count: 2, last_passed_at: '2026-01-01T00:00:00.000Z', last_liked_at: null };
    await recordMovieState('u1', 'm1', true);
    expect(upsertMock.mock.calls[0][0]).toMatchObject({
      pass_count: 2, last_passed_at: '2026-01-01T00:00:00.000Z', last_liked_at: expect.any(String),
    });
  });
});

describe('getMovieStates', () => {
  it('arma el Map desde las filas', async () => {
    statesRows = [{ movie_id: 'm1', pass_count: 1, last_passed_at: 'x', last_liked_at: null }];
    const map = await getMovieStates('u1', ['m1', 'm2']);
    expect(map.get('m1')).toEqual({ pass_count: 1, last_passed_at: 'x', last_liked_at: null });
    expect(map.has('m2')).toBe(false);
  });

  it('movieIds vacío → Map vacío', async () => {
    const map = await getMovieStates('u1', []);
    expect(map.size).toBe(0);
  });
});

describe('orderByNovelty', () => {
  it('nunca-vistas primero; entre vistas last_passed_at asc (null = alta prioridad); pass_count desempata', () => {
    const movies = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const states = new Map([
      ['a', { pass_count: 1, last_passed_at: '2026-06-20T00:00:00.000Z', last_liked_at: null }],
      ['c', { pass_count: 1, last_passed_at: '2026-06-01T00:00:00.000Z', last_liked_at: null }],
      ['d', { pass_count: 0, last_passed_at: null, last_liked_at: '2026-06-10T00:00:00.000Z' }],
    ]);
    // b nunca vista → primero. Entre vistas: d (null=0) < c (jun-01) < a (jun-20).
    expect(orderByNovelty(movies, states).map((m) => m.id)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('mismo last_passed_at: menor pass_count primero', () => {
    const movies = [{ id: 'x' }, { id: 'y' }];
    const states = new Map([
      ['x', { pass_count: 3, last_passed_at: '2026-06-01T00:00:00.000Z', last_liked_at: null }],
      ['y', { pass_count: 1, last_passed_at: '2026-06-01T00:00:00.000Z', last_liked_at: null }],
    ]);
    expect(orderByNovelty(movies, states).map((m) => m.id)).toEqual(['y', 'x']);
  });

  it('sin estados preserva el orden de entrada; pool vacío → []', () => {
    const movies = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(orderByNovelty(movies, new Map()).map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(orderByNovelty([], new Map())).toEqual([]);
  });
});
