import { describe, it, expect, vi, beforeEach } from 'vitest';

let cache: Record<string, any>;
let moviesByTmdbId: Record<string, { id: string } | null>;
let insertResult: { data: any; error: any };
let details: any;
let ref: any;

const upsertMock = vi.fn();
const insertMock = vi.fn();
const updateMock = vi.fn();
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
        eq: (col: string, val: any) => ({
          maybeSingle: () =>
            Promise.resolve({
              data: table === 'letterboxd_films' ? (cache[val] ?? null) : (moviesByTmdbId[`${col}:${val}`] ?? null),
            }),
        }),
      }),
      insert: (payload: any) => {
        insertMock(payload);
        return { select: () => ({ single: () => Promise.resolve(insertResult) }) };
      },
      upsert: (payload: any) => {
        upsertMock(payload);
        return Promise.resolve({ error: null });
      },
      update: (payload: any) => {
        updateMock(payload);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  },
}));

import { resolveMovie } from './movies.js';

const FILM = { slug: 'parasite', title: 'Parasite', year: 2019 };

beforeEach(() => {
  cache = {};
  moviesByTmdbId = {};
  insertResult = { data: { id: 'nuevo' }, error: null };
  ref = { tmdbId: 496243, tmdbType: 'movie' };
  details = {
    tmdbId: 496243, tmdbType: 'movie', title: 'Parasite', originalTitle: '기생충', year: 2019,
    posterUrl: null, director: 'Bong Joon-ho', cast: null, runtime: 132, genres: null,
    overview: null, tmdbRating: 8.5, country: 'KR', enriched: true,
  };
  upsertMock.mockClear();
  insertMock.mockClear();
  updateMock.mockClear();
  fetchRefMock.mockClear();
});

describe('resolveMovie', () => {
  it('cache hit por slug: devuelve el movie_id sin tocar la red', async () => {
    cache['parasite'] = { slug: 'parasite', tmdb_id: 496243, tmdb_type: 'movie', movie_id: 'cacheada' };
    expect(await resolveMovie(FILM)).toEqual({ id: 'cacheada' });
    expect(fetchRefMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('cache miss: lee el tmdb_id de la página del film, inserta y cachea el mapping', async () => {
    expect(await resolveMovie(FILM)).toEqual({ id: 'nuevo' });
    expect(fetchRefMock).toHaveBeenCalledWith('parasite');
    expect(insertMock.mock.calls[0][0]).toMatchObject({ tmdb_id: 496243, tmdb_type: 'movie', enriched: true });
    expect(upsertMock.mock.calls[0][0]).toMatchObject({
      slug: 'parasite', tmdb_id: 496243, tmdb_type: 'movie', movie_id: 'nuevo',
    });
  });

  it('un slug cacheado sin movie_id se re-resuelve entero (por si el ID cambió)', async () => {
    cache['parasite'] = { slug: 'parasite', tmdb_id: 496243, tmdb_type: 'movie', movie_id: null };
    expect(await resolveMovie(FILM)).toEqual({ id: 'nuevo' });
    expect(fetchRefMock).toHaveBeenCalledWith('parasite');
  });

  it('si la página no trae data-tmdb-id, no guarda nada y devuelve null', async () => {
    ref = null;
    expect(await resolveMovie(FILM)).toBeNull();
    expect(insertMock).not.toHaveBeenCalled();
    expect(upsertMock.mock.calls[0][0]).toMatchObject({
      slug: 'parasite', tmdb_id: null, movie_id: null, resolved_at: null,
    });
  });

  it('si el ID de Letterboxd está muerto en TMDB, no guarda nada y devuelve null', async () => {
    details = null; // fetchById devuelve null ante el 404 de TMDB
    expect(await resolveMovie(FILM)).toBeNull();
    expect(insertMock).not.toHaveBeenCalled();
    // El intento se cachea con el tmdb_id que dio Letterboxd, pero sin movie_id:
    // el próximo refresh lo reintenta desde cero.
    expect(upsertMock.mock.calls[0][0]).toMatchObject({
      slug: 'parasite', tmdb_id: 496243, movie_id: null, resolved_at: null,
    });
  });

  it('ante conflicto por tmdb_id recupera la fila existente y la linkea al slug', async () => {
    insertResult = { data: null, error: { code: '23505', message: 'movies_tmdb_id_key' } };
    moviesByTmdbId['tmdb_id:496243'] = { id: 'existente' };
    expect(await resolveMovie(FILM)).toEqual({ id: 'existente' });
    expect(upsertMock.mock.calls[0][0]).toMatchObject({ slug: 'parasite', movie_id: 'existente' });
  });

  it('la fila legacy recuperada se pisa con los datos frescos (backfill de tmdb_type)', async () => {
    insertResult = { data: null, error: { code: '23505', message: 'movies_tmdb_id_key' } };
    moviesByTmdbId['tmdb_id:496243'] = { id: 'legacy' };
    await resolveMovie(FILM);
    expect(updateMock.mock.calls[0][0]).toMatchObject({
      tmdb_id: 496243, tmdb_type: 'movie', director: 'Bong Joon-ho', enriched: true,
    });
  });

  it('nunca llega al insert si no hay datos enriquecidos', async () => {
    ref = null;
    insertResult = { data: null, error: { code: '23505', message: 'movies_tmdb_id_key' } };
    expect(await resolveMovie(FILM)).toBeNull();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('si el insert falla y no aparece ninguna fila, propaga el error real (no null.id)', async () => {
    insertResult = { data: null, error: { code: '23502', message: 'null value in column' } };
    await expect(resolveMovie(FILM)).rejects.toMatchObject({ code: '23502' });
  });

  it('serie: propaga tmdb_type tv', async () => {
    ref = { tmdbId: 1399, tmdbType: 'tv' };
    details = { ...details, tmdbId: 1399, tmdbType: 'tv', title: 'Game of Thrones' };
    await resolveMovie({ slug: 'game-of-thrones', title: 'Game of Thrones', year: 2011 });
    expect(insertMock.mock.calls[0][0]).toMatchObject({ tmdb_id: 1399, tmdb_type: 'tv' });
  });
});
