// backend/src/letterboxd.ts
// ÚNICO módulo acoplado al HTML de Letterboxd. Si cambia el markup, se arregla acá.

export interface ScrapedFilm {
  title: string;
  year: number | null;
}

// Cada poster expone `data-film-slug="..."` y, más adelante en el mismo bloque,
// un <img ... alt="Título">. El non-greedy puentea del slug al próximo alt.
const FILM_RE = /data-film-slug="([^"]*)"[\s\S]*?<img\b[^>]*\balt="([^"]*)"/g;

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
    const slug = m[1];
    const title = unescapeHtml(m[2]).trim();
    if (!title) continue;
    const yearMatch = slug.match(/-(\d{4})$/);
    const year = yearMatch ? Number(yearMatch[1]) : null;
    films.push({ title, year });
  }
  return films;
}
