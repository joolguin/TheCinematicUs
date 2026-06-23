# Watchlists desde Letterboxd — Diseño

**Fecha:** 2026-06-23
**Estado:** Aprobado, listo para plan de implementación

## Objetivo

Eliminar la carga manual de títulos. El pozo de películas se arma scrapeando las
watchlists públicas de Letterboxd de ambas usuarias y guardándolas persistentes en
la DB. Un botón manual dispara el scrape antes de empezar el match; no hay cron.

## Principios que se mantienen

- **El match es ocasional.** Cada sesión (noche) arranca de cero: la baraja vuelve a
  ser la watchlist completa, los swipes se resetean. Nada de "ya visto" se arrastra.
- **Privacidad de likes.** Sin cambios: `swipes` y `watchlist_items` siguen sin policy
  para anon; el backend (service role) hace la lectura cruzada.

## Decisiones tomadas

| Decisión | Elección |
|---|---|
| Fuente | Watchlist pública de Letterboxd, una URL por usuaria |
| Config de URLs | Fijas en DB (seed/SQL), sin UI de configuración |
| Trigger del scrape | Manual, un solo botón que scrapea **ambas**. Sin cron. |
| Restart / baraja agotada | Noche arranca de cero; sin exclusión permanente de vistas |
| Sync al re-scrapear | **Replace-on-success** por usuaria (los removidos en Letterboxd salen del pozo) |
| Modo | Solo "pozo común" (intersección queda fuera de scope) |

---

## Modelo de datos

**`users`** — nueva columna:
```sql
alter table users add column if not exists letterboxd_url text;
-- seed (URLs reales se setean a mano):
update users set letterboxd_url = 'https://letterboxd.com/<jo>/watchlist/' where name = 'Jo';
update users set letterboxd_url = 'https://letterboxd.com/<vale>/watchlist/' where name = 'Vale';
```

**`watchlist_items`** — se **desacopla de sesiones**. Pasa de
`(session_id, user_id, movie_id)` a watchlist persistente por usuaria:
```sql
-- Migración idempotente:
alter table watchlist_items drop constraint if exists watchlist_items_session_id_fkey;
-- vaciar lo viejo (estaba scopeado por sesión, ya no aplica)
delete from watchlist_items;
alter table watchlist_items drop column if exists session_id;
-- nueva unicidad: una fila por (usuaria, película)
create unique index if not exists watchlist_items_user_movie
  on watchlist_items (user_id, movie_id);
```
Resultado: `watchlist_items (id, user_id, movie_id)` con único `(user_id, movie_id)`.

**`swipes`, `matches`, `sessions`** — sin cambios. Siguen scopeados por sesión.

---

## Scraping

Módulo aislado `backend/src/letterboxd.ts` (un solo lugar para arreglar si cambia el
HTML de Letterboxd).

```ts
export interface ScrapedFilm { title: string; year: number | null; }

// Recorre las páginas de la watchlist hasta una vacía. Devuelve films deduplicados.
export async function scrapeWatchlist(url: string): Promise<ScrapedFilm[]>;
```

- Letterboxd watchlist es HTML público paginado: `…/watchlist/`, `…/watchlist/page/2/`, …
  Se recorren páginas hasta que una no traiga posters.
- De cada poster se extrae el título; el año si está disponible en el slug
  (ej. `parasite-2019`) o atributos del markup, si no `null`.
- Cada film se resuelve con el `resolveMovie(title, year)` existente → enrich TMDB +
  cache en `movies`. **El primer scrape es lento** (muchas llamadas a TMDB); los
  siguientes son rápidos (cache hits).
- Sin API key: es scrape de HTML no oficial, frágil por naturaleza. Aislado en este módulo.

---

## Endpoint

`POST /watchlists/refresh`

Para cada usuaria (Jo, Vale):
1. Lee `letterboxd_url`.
2. `scrapeWatchlist(url)` → lista de films.
3. Resuelve cada film con `resolveMovie`.
4. **Replace-on-success:** si el scrape devolvió **≥1 película**, borra las
   `watchlist_items` de esa usuaria e inserta el set nuevo. Si devolvió 0 / falló,
   **se mantiene** el set anterior y se reporta el error.

El procesamiento de las dos usuarias es independiente: Jo puede tener éxito aunque
Vale falle.

**Respuesta:**
```json
{
  "Jo":   { "count": 142, "ok": true },
  "Vale": { "count": 0,   "ok": false, "error": "scrape vacío" }
}
```

- Request síncrona; el frontend muestra spinner ("esto puede tardar la primera vez").
- Tradeoff aceptado: con cache fría y listas grandes puede tardar decenas de segundos.
  Si alguna vez da timeout, se migra a background + polling (YAGNI por ahora).

---

## Cambios en `/deck`

Hoy: `watchlist_items where session_id = sesión activa`.
Nuevo: unión de las `watchlist_items` de **todas** las usuarias (el pozo persistente),
menos lo que esta usuaria ya swipeó **en la sesión activa**.

```
movieIds  = distinct(watchlist_items.movie_id)              -- pozo de ambas
swipedIds = swipes where session_id = activa and user_id = yo
deck      = movies where id in (movieIds - swipedIds)
```

---

## Flujo y UX

**Routing (`App.tsx`):** `Gate → UserSelect → Swipe` directo (sin paso de import
obligatorio, porque las watchlists persisten).

**Pantalla Watchlists** (reemplaza a la vieja `Import`):
- Muestra contadores por usuaria del último sync.
- Botón **"Actualizar watchlists"** → `POST /watchlists/refresh` con spinner.
- Línea de resultado por usuaria: `Jo: 142 ✓ · Vale: 98 ✓`, o
  `Vale: error — se mantuvo la lista anterior`.
- Botón **"Empezar a swipear"**.
- Se elimina el `textarea` de pegar títulos y el flujo `/import` de la UI.

**Accesos a la pantalla Watchlists:**
1. Estado de mazo vacío en `Swipe`: su botón "Importar películas" pasa a
   "Actualizar watchlists".
2. Afordancia en el header de `Swipe` para refrescar **antes** de empezar un match.

**Coordinación de sync (reusa lo ya construido):** cuando una refresca el pozo, el
deck de la otra queda viejo. Para el MVP se reusa el botón manual **"🔄 recargar
deck"** ya existente en la pantalla Watchlists, y un aviso liviano "se actualizó el
pozo" en `Swipe`. El broadcast automático del pozo queda como mejora futura
(la misma que ya diferimos para el sync de import).

---

## Casos evaluados

| Caso | Comportamiento |
|---|---|
| Baraja agotada **con** match → elegir peli → nueva sesión | Deck vuelve a la watchlist completa (noche de cero) |
| Baraja agotada **sin** match → nueva sesión | Mismo deck; o "Actualizar watchlists" para traer títulos nuevos |
| Scrape de una usuaria falla | Se mantiene su watchlist anterior; la otra puede haber tenido éxito |
| Scrape vacío (URL mala / watchlist privada o vacía) | Se trata como fallo; se mantiene el set anterior |
| Peli removida de Letterboxd | Replace-on-success la saca del pozo. Si ya se swipeó en la sesión, el `swipe` queda (inofensivo, la peli sigue en cache `movies`) |
| Refresh mientras la otra swipea | Su deck queda viejo → recarga manual / aviso |
| Primer scrape (cache fría) | Lento; spinner lo cubre |
| Misma peli en ambas watchlists | El deck deduplica por `movie_id` (ya lo hace) |
| Peli que TMDB no resuelve | Registro mínimo (`enriched=false`), igual aparece |
| Ambas tocan "Actualizar" a la vez | Replace por usuaria; puede haber doble scrape, aceptable |

---

## Fuera de scope

- Cron / scrape programado.
- Carga manual de títulos (se elimina).
- Modo intersección.
- Broadcast automático del pozo (queda como mejora futura).
- UI para editar las URLs de Letterboxd (se setean por SQL).
