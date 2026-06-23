// backend/src/letterboxd.test.ts
import { afterEach, describe, it, expect, vi } from 'vitest';
import { parseWatchlistPage, scrapeWatchlist } from './letterboxd.js';

const PAGE = `
<ul class="poster-list">
  <li class="poster-container">
    <div class="film-poster" data-film-slug="parasite-2019">
      <img class="image" alt="Parasite" />
    </div>
  </li>
  <li class="poster-container">
    <div class="film-poster" data-film-slug="amelie">
      <img class="image" alt="Am&eacute;lie" />
    </div>
  </li>
</ul>
`;

describe('parseWatchlistPage', () => {
  it('extrae título y año del slug', () => {
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

function htmlFor(slugs: string[]): string {
  return slugs
    .map((s) => `<div class="film-poster" data-film-slug="${s}"><img alt="${s}" /></div>`)
    .join('');
}

describe('scrapeWatchlist', () => {
  it('recorre páginas hasta una vacía y deduplica', async () => {
    const pages: Record<string, string> = {
      'https://letterboxd.com/jo/watchlist/': htmlFor(['drive-2011', 'parasite-2019']),
      'https://letterboxd.com/jo/watchlist/page/2/': htmlFor(['parasite-2019', 'her-2013']),
      'https://letterboxd.com/jo/watchlist/page/3/': '<ul></ul>',
    };
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({ ok: true, text: () => Promise.resolve(pages[url] ?? '<ul></ul>') }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const films = await scrapeWatchlist('https://letterboxd.com/jo/watchlist/');
    expect(films).toEqual([
      { title: 'drive-2011', year: 2011 },
      { title: 'parasite-2019', year: 2019 },
      { title: 'her-2013', year: 2013 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('corta si una página responde con error HTTP', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, text: () => Promise.resolve('') }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await scrapeWatchlist('https://letterboxd.com/jo/watchlist/')).toEqual([]);
  });
});
