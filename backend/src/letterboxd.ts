// backend/src/letterboxd.ts
// ÚNICO módulo acoplado al HTML de Letterboxd. Si cambia el markup, se arregla acá.

export interface ScrapedFilm {
  title: string;
  year: number | null;
}

// Cada poster es un react-component `LazyPoster` con el título y año juntos en
// `data-item-name` (ej. `Parasite (2019)`). Los posters se cargan lazy, así que en
// el HTML server-rendered NO hay <img alt>; este atributo es la fuente estable.
const FILM_RE = /data-item-name="([^"]*)"/g;

// Desescapa las entidades HTML más comunes en títulos.
function unescapeHtml(s: string): string {
  return s
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
  for (const m of html.matchAll(FILM_RE)) {
    const name = unescapeHtml(m[1]).trim(); // "Parasite (2019)"
    if (!name) continue;
    // Separa "Título (Año)"; si no hay año, queda null.
    const ym = name.match(/^(.*?)\s*\((\d{4})\)\s*$/);
    if (ym) films.push({ title: ym[1].trim(), year: Number(ym[2]) });
    else films.push({ title: name, year: null });
  }
  return films;
}

const MAX_PAGES = 50; // tope de seguridad ante un bucle inesperado
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Recorre las páginas de la watchlist hasta una vacía. Devuelve films deduplicados.
export async function scrapeWatchlist(url: string): Promise<ScrapedFilm[]> {
  const base = url.endsWith('/') ? url : url + '/';
  const seen = new Map<string, ScrapedFilm>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageUrl = page === 1 ? base : `${base}page/${page}/`;
    const res = await fetch(pageUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) break;
    const films = parseWatchlistPage(await res.text());
    if (films.length === 0) break;
    for (const f of films) {
      const key = `${f.title.toLowerCase()}|${f.year ?? ''}`;
      if (!seen.has(key)) seen.set(key, f);
    }
  }
  return [...seen.values()];
}
