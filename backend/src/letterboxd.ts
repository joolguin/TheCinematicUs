export interface ScrapedFilm {
  slug: string;
  title: string;
  year: number | null;
}

export interface TmdbRef {
  tmdbId: number;
  tmdbType: 'movie' | 'tv';
}

const FILM_RE = /<div\b[^>]*\bdata-item-slug="[^"]*"[^>]*>/g;
const ATTR_RE = (name: string) => new RegExp(`\\b${name}="([^"]*)"`);

function unescapeHtml(text: string): string {
  return text
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&agrave;/g, 'à')
    .replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó')
    .replace(/&uacute;/g, 'ú')
    .replace(/&ntilde;/g, 'ñ')
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(ATTR_RE(name));
  return match ? unescapeHtml(match[1]).trim() : null;
}

export function parseWatchlistPage(html: string): ScrapedFilm[] {
  const films: ScrapedFilm[] = [];
  for (const match of html.matchAll(FILM_RE)) {
    const slug = attr(match[0], 'data-item-slug');
    if (!slug) continue;
    const name = attr(match[0], 'data-item-name') ?? '';
    const titleWithYear = name.match(/^(.*?)\s*\((\d{4})\)\s*$/);
    if (titleWithYear) films.push({ slug, title: titleWithYear[1].trim(), year: Number(titleWithYear[2]) });
    else films.push({ slug, title: name || slug, year: null });
  }
  return films;
}

const BODY_RE = /<body\b[^>]*>/;

export function parseFilmTmdbRef(html: string): TmdbRef | null {
  const body = html.match(BODY_RE);
  if (!body) return null;
  const id = attr(body[0], 'data-tmdb-id');
  const type = attr(body[0], 'data-tmdb-type');
  if (!id || !/^\d+$/.test(id)) return null;
  if (type !== 'movie' && type !== 'tv') return null;
  return { tmdbId: Number(id), tmdbType: type };
}

const MAX_PAGES = 50;
const DEFAULT_DELAY_MS = 1500;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Letterboxd no tiene API pública: se scrapea con un mínimo entre requests.
// Global al proceso (páginas de watchlist y de film comparten la cuota).
// LETTERBOXD_DELAY_MS=0 en tests.
let lastRequestAt = 0;

function delayMs(): number {
  const raw = process.env.LETTERBOXD_DELAY_MS;
  return raw === undefined ? DEFAULT_DELAY_MS : Number(raw);
}

async function throttledFetch(url: string): Promise<Response> {
  const wait = lastRequestAt + delayMs() - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  return fetch(url, { headers: { 'User-Agent': USER_AGENT } });
}

/**
 * Lee el TMDB ID que Letterboxd publica en el <body> de la página del film.
 * Devuelve null si la página falla o no trae el atributo (peli sin TMDB
 * asociado del lado de Letterboxd) — el llamador decide el fallback.
 */
export async function fetchFilmTmdbRef(slug: string): Promise<TmdbRef | null> {
  try {
    const response = await throttledFetch(`https://letterboxd.com/film/${slug}/`);
    if (!response.ok) return null;
    return parseFilmTmdbRef(await response.text());
  } catch {
    return null;
  }
}

export async function scrapeWatchlist(url: string): Promise<ScrapedFilm[]> {
  const base = url.endsWith('/') ? url : url + '/';
  const seen = new Map<string, ScrapedFilm>();
  let firstStatus: number | undefined;
  let firstBytes = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageUrl = page === 1 ? base : `${base}page/${page}/`;
    const response = await throttledFetch(pageUrl);
    if (page === 1) firstStatus = response.status;
    if (!response.ok) break;
    const html = await response.text();
    if (page === 1) firstBytes = html.length;
    const films = parseWatchlistPage(html);
    if (films.length === 0) break;
    for (const film of films) {
      if (!seen.has(film.slug)) seen.set(film.slug, film);
    }
  }

  if (seen.size === 0) {
    throw new Error(`sin films (page 1: HTTP ${firstStatus ?? '?'}, ${firstBytes} bytes)`);
  }
  return [...seen.values()];
}
