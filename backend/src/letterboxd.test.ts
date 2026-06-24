// backend/src/letterboxd.test.ts
import { afterEach, describe, it, expect, vi } from 'vitest';
import { parseWatchlistPage, scrapeWatchlist } from './letterboxd.js';

// Markup real de Letterboxd (2026): cada poster es un react-component LazyPoster
// con el título+año en `data-item-name`. Ya no hay `data-film-slug` ni <img alt>.
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
  it('extrae título y año de data-item-name', () => {
    expect(parseWatchlistPage(PAGE)).toEqual([
      { title: 'Parasite', year: 2019 },
      { title: 'Amélie', year: null },
    ]);
  });

  it('devuelve [] en una página sin posters', () => {
    expect(parseWatchlistPage('<ul class="poster-list"></ul>')).toEqual([]);
  });
});

afterEach(() => vi.unstubAllGlobals());

function htmlFor(names: string[]): string {
  return names
    .map((n) => `<div class="react-component" data-item-name="${n}" data-item-slug="x"></div>`)
    .join('');
}

describe('scrapeWatchlist', () => {
  it('recorre páginas hasta una vacía y deduplica', async () => {
    const pages: Record<string, string> = {
      'https://letterboxd.com/jo/watchlist/': htmlFor(['Drive (2011)', 'Parasite (2019)']),
      'https://letterboxd.com/jo/watchlist/page/2/': htmlFor(['Parasite (2019)', 'Her (2013)']),
      'https://letterboxd.com/jo/watchlist/page/3/': '<ul></ul>',
    };
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({ ok: true, text: () => Promise.resolve(pages[url] ?? '<ul></ul>') }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const films = await scrapeWatchlist('https://letterboxd.com/jo/watchlist/');
    expect(films).toEqual([
      { title: 'Drive', year: 2011 },
      { title: 'Parasite', year: 2019 },
      { title: 'Her', year: 2013 },
    ]);
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
