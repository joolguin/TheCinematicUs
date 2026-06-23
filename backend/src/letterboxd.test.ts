// backend/src/letterboxd.test.ts
import { describe, it, expect } from 'vitest';
import { parseWatchlistPage } from './letterboxd.js';

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
