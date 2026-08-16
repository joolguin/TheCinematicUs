import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest';
import { parseWatchlistPage, parseFilmTmdbRef, fetchFilmTmdbRef, scrapeWatchlist } from './letterboxd.js';

beforeAll(() => {
  process.env.LETTERBOXD_DELAY_MS = '0';
});

const PAGE = `
<ul class="poster-list">
  <li class="poster-container">
    <div class="react-component" data-component-class="LazyPoster"
         data-item-name="Parasite (2019)" data-item-slug="parasite"></div>
  </li>
  <li class="poster-container">
    <div class="react-component" data-component-class="LazyPoster"
         data-item-name="Am&eacute;lie" data-item-slug="amelie"></div>
  </li>
</ul>
`;

describe('parseWatchlistPage', () => {
  it('extrae slug, título y año', () => {
    expect(parseWatchlistPage(PAGE)).toEqual([
      { slug: 'parasite', title: 'Parasite', year: 2019 },
      { slug: 'amelie', title: 'Amélie', year: null },
    ]);
  });

  it('tolera el orden inverso de atributos', () => {
    const html = '<div data-item-slug="drive" class="react-component" data-item-name="Drive (2011)"></div>';
    expect(parseWatchlistPage(html)).toEqual([{ slug: 'drive', title: 'Drive', year: 2011 }]);
  });

  it('cae al slug como título si falta data-item-name', () => {
    expect(parseWatchlistPage('<div data-item-slug="sin-nombre"></div>')).toEqual([
      { slug: 'sin-nombre', title: 'sin-nombre', year: null },
    ]);
  });

  it('devuelve [] en una página sin posters', () => {
    expect(parseWatchlistPage('<ul class="poster-list"></ul>')).toEqual([]);
  });
});

describe('parseFilmTmdbRef', () => {
  it('lee data-tmdb-id y data-tmdb-type del body', () => {
    const html = '<html><body class="film backdropped" data-type="film" data-tmdb-type="movie" data-tmdb-id="496243">';
    expect(parseFilmTmdbRef(html)).toEqual({ tmdbId: 496243, tmdbType: 'movie' });
  });

  it('reconoce series (tv)', () => {
    expect(parseFilmTmdbRef('<body data-tmdb-type="tv" data-tmdb-id="1399">')).toEqual({
      tmdbId: 1399, tmdbType: 'tv',
    });
  });

  it('devuelve null si falta el atributo', () => {
    expect(parseFilmTmdbRef('<body class="film">')).toBeNull();
  });

  it('devuelve null si el id no es numérico o el type es desconocido', () => {
    expect(parseFilmTmdbRef('<body data-tmdb-type="movie" data-tmdb-id="">')).toBeNull();
    expect(parseFilmTmdbRef('<body data-tmdb-type="person" data-tmdb-id="7">')).toBeNull();
  });

  it('devuelve null si no hay body', () => {
    expect(parseFilmTmdbRef('<html></html>')).toBeNull();
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('fetchFilmTmdbRef', () => {
  it('pide la página del film y devuelve el ref', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve('<body data-tmdb-type="movie" data-tmdb-id="496243">'),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchFilmTmdbRef('parasite')).toEqual({ tmdbId: 496243, tmdbType: 'movie' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://letterboxd.com/film/parasite/');
  });

  it('devuelve null ante HTTP de error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') })));
    expect(await fetchFilmTmdbRef('no-existe')).toBeNull();
  });

  it('devuelve null si el fetch tira (red caída)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNRESET'))));
    expect(await fetchFilmTmdbRef('parasite')).toBeNull();
  });
});

function htmlFor(slugs: string[]): string {
  return slugs
    .map((s) => `<div class="react-component" data-item-name="${s} (2011)" data-item-slug="${s}"></div>`)
    .join('');
}

describe('scrapeWatchlist', () => {
  it('recorre páginas hasta una vacía y deduplica por slug', async () => {
    const pages: Record<string, string> = {
      'https://letterboxd.com/jo/watchlist/': htmlFor(['drive', 'parasite']),
      'https://letterboxd.com/jo/watchlist/page/2/': htmlFor(['parasite', 'her']),
      'https://letterboxd.com/jo/watchlist/page/3/': '<ul></ul>',
    };
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({ ok: true, text: () => Promise.resolve(pages[url] ?? '<ul></ul>') }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const films = await scrapeWatchlist('https://letterboxd.com/jo/watchlist/');
    expect(films.map((f) => f.slug)).toEqual(['drive', 'parasite', 'her']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('lanza con el status si la primera página da error HTTP', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve('') }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(scrapeWatchlist('https://letterboxd.com/jo/watchlist/')).rejects.toThrow('403');
  });

  it('lanza si la primera página viene 200 pero sin films (página-desafío/markup)', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<html>nada</html>') }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(scrapeWatchlist('https://letterboxd.com/jo/watchlist/')).rejects.toThrow(/200/);
  });
});
