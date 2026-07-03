export interface ScrapedFilm {
  title: string;
  year: number | null;
}

const FILM_RE = /data-item-name="([^"]*)"/g;

function unescapeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&agrave;/g, 'à')
    .replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó')
    .replace(/&uacute;/g, 'ú')
    .replace(/&ntilde;/g, 'ñ');
}

export function parseWatchlistPage(html: string): ScrapedFilm[] {
  const films: ScrapedFilm[] = [];
  for (const match of html.matchAll(FILM_RE)) {
    const name = unescapeHtml(match[1]).trim();
    if (!name) continue;
    const titleWithYear = name.match(/^(.*?)\s*\((\d{4})\)\s*$/);
    if (titleWithYear) films.push({ title: titleWithYear[1].trim(), year: Number(titleWithYear[2]) });
    else films.push({ title: name, year: null });
  }
  return films;
}

const MAX_PAGES = 50;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export async function scrapeWatchlist(url: string): Promise<ScrapedFilm[]> {
  const base = url.endsWith('/') ? url : url + '/';
  const seen = new Map<string, ScrapedFilm>();
  let firstStatus: number | undefined;
  let firstBytes = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageUrl = page === 1 ? base : `${base}page/${page}/`;
    const response = await fetch(pageUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (page === 1) firstStatus = response.status;
    if (!response.ok) break;
    const html = await response.text();
    if (page === 1) firstBytes = html.length;
    const films = parseWatchlistPage(html);
    if (films.length === 0) break;
    for (const film of films) {
      const key = `${film.title.toLowerCase()}|${film.year ?? ''}`;
      if (!seen.has(key)) seen.set(key, film);
    }
  }

  if (seen.size === 0) {
    throw new Error(`sin films (page 1: HTTP ${firstStatus ?? '?'}, ${firstBytes} bytes)`);
  }
  return [...seen.values()];
}
