# TheCinematicUs

---

## La idea 

Jo y Vale quieren ver una peli juntas y les cuesta decidir. Las dos usan **Letterboxd** y mantienen watchlists públicas. El sistema arma un **pozo** con las películas de ambas watchlists y cada una **swipea** qué se le antoja esa noche, **en privado**. Cuando **las dos** dan like a la misma peli → **match**, y esa es la candidata.

**Dos principios de producto que gobiernan todas las decisiones técnicas:**

1. **Privacidad de los likes.** Ninguna ve qué likeó la otra hasta que hay match. El valor es decidir **sin sentirse influenciada**. Está garantizado a nivel de base de datos (RLS), no por confianza en la UI.
2. **El match es ocasional.** Un like es del momento, no un estado permanente. Cada **sesión** (= una noche) arranca de cero: la baraja vuelve a ser la watchlist completa y los swipes se resetean. El **pozo de películas sí persiste** (no hay que re-importar cada noche); lo que se resetea por sesión son los swipes y los matches.

---

## Arquitectura


```
┌─────────────┐   REST (passphrase)   ┌──────────────┐   scrape HTTP   ┌────────────┐
│  Frontend   │ ────────────────────▶ │   Backend    │ ──────────────▶ │ Letterboxd │
│  (Vercel)   │                       │   (Render)   │                 │  (público) │
│  React/Vite │ ◀───── REST ───────── │  Express/TS  │ ──── REST ────▶ │    TMDB    │
└──────┬──────┘                       └──────┬───────┘                 └────────────┘
       │  Supabase JS (solo Realtime)        │ service role (bypassa RLS)
       └──────────────┬──────────────────────┘
                      ▼
            ┌────────────────────┐
            │  Supabase Postgres │  (+ Realtime en matches y sessions)
            └────────────────────┘
```

- **Frontend (Vercel):** habla con el backend por REST. Usa Supabase JS **solo** para suscribirse a Realtime (`matches` y `sessions`). Nunca toca las keys privadas ni lee `swipes`/`watchlist_items`.
- **Backend (Render):** dueño de las keys privadas (TMDB, Supabase service role). Scrapea Letterboxd, resuelve/cachea TMDB, registra swipes, detecta matches, maneja sesiones. Es quien hace la **lectura cruzada** de likes que la privacidad prohíbe al frontend.
- **DB (Supabase):** Postgres + Realtime + RLS.


---

## Modelo de datos (tablas en Supabase)

Definición canónica: `backend/db/schema.sql` (incluye migraciones idempotentes datadas; ver al final del archivo).

| Tabla | Para qué | Notas clave |
|---|---|---|
| `users` | Jo y Vale (fijas, sembradas) | **Las URLs de Letterboxd NO van acá, van por env.** |
| `movies` | Cache de TMDB | `tmdb_id unique`, `search_key unique` (clave de cache `título\|año`). |
| `sessions` | La "noche" | `active boolean`, índice único parcial `one_active_session` ⇒ **una sola activa**. `started_by` para el aviso en vivo. |
| `watchlist_items` | **El pozo persistente** | `(user_id, movie_id)` único. **Desacoplada de sesiones** (no tiene `session_id`). |
| `swipes` | Likes/pasos de la noche | scopeada por `session_id` + `user_id`. **Sin RLS para anon** ⇒ privada. |
| `matches` | Coincidencias de la noche | scopeada por sesión. Publicada en Realtime. |

**RLS / privacidad:** `movies`, `users`, `sessions`, `matches` son legibles por la anon key (frontend). `swipes` y `watchlist_items` **no tienen policy para anon** ⇒ nadie con la anon key los lee. Solo el backend (service role, que ignora RLS) los toca. **No agregar policies anon a esas dos tablas.**

---

## Scraping de Letterboxd (el punto frágil — entender bien)

Todo el acoplamiento al HTML de Letterboxd vive **aislado** en `backend/src/letterboxd.ts`. Si algo se rompe del lado de Letterboxd, se arregla solo ahí.

- **Fuente:** la watchlist pública paginada: `…/watchlist/`, `…/watchlist/page/2/`, … Se recorren páginas hasta una sin posters.
- **Markup (importante):** cada película es un `<div class="react-component" data-component-class="LazyPoster" data-item-name="Título (Año)" data-item-slug="...">`. Los posters se cargan lazy, así que en el HTML server-rendered **no hay `<img alt>`**. La fuente estable es **`data-item-name`** (trae título y año juntos, ej. `Parasite (2019)`). *(Ojo: Letterboxd ya cambió el markup una vez —antes era `data-film-slug` + `img alt`—; si vuelve a romperse, es acá.)*
- **`parseWatchlistPage(html)`**: regex sobre `data-item-name`, separa `Título (Año)`.
- **`scrapeWatchlist(url)`**: pagina, deduplica por `título|año`. Si termina con **0 films, lanza un error con diagnóstico** (`sin films (page 1: HTTP <status>, <bytes> bytes)`) para distinguir bloqueo (403) de markup cambiado o lista vacía.
- **Replace-on-success por usuaria** (`backend/src/watchlists.ts`): si el scrape trae ≥1 peli, **borra e inserta** el set de esa usuaria; si trae 0 o falla, **mantiene** el set anterior y reporta el error. Las dos usuarias se procesan independientes (una puede fallar sin frenar a la otra). Un fallo al resolver TMDB también se aísla por usuaria.

---

## Resolución y cache de TMDB

`backend/src/movies.ts` → `resolveMovie(title, year)`:
1. Busca en cache por `search_key` (`título|año` normalizado). Si está, devuelve su id.
2. Si no, `searchAndEnrich` contra TMDB (póster, dirección, reparto, duración, géneros, sinopsis, rating, país). Si TMDB no resuelve, guarda un **registro mínimo** (`enriched=false`) para que la peli igual aparezca.
3. Inserta en `movies`. **Ante conflicto de insert** recupera por `tmdb_id` primero (dos títulos distintos pueden resolver a la **misma** peli de TMDB), luego por `search_key` (carrera de misma búsqueda); si no aparece nada, **propaga el error real**. *(Este último punto fue un bug: antes solo re-leía por `search_key` y crasheaba con `Cannot read properties of null (reading 'id')` cuando la colisión era por `tmdb_id`.)*

El **primer scrape es lento** (muchas llamadas a TMDB); los siguientes son rápidos (cache hits en `movies`).

---

## Sesiones, match y tiempo real

- **Una sola sesión activa** garantizada por el índice único parcial `one_active_session`. `createSession` desactiva la anterior y, ante carrera (error 23505), re-lee la ganadora.
- **Match:** `recordSwipeAndDetectMatch` detecta al registrar el swipe; `reconcileMatches` es una **red de seguridad** que se corre antes de leer matches y tras cada like (cubre carreras). Un match = dos usuarias distintas likearon la misma peli en la misma sesión.
- **Realtime:** el frontend se suscribe a `matches` (overlay + contador en vivo) y a `sessions` (hook `useSessionListener`: si la otra inicia una noche nueva, reacomoda la pantalla). El pozo NO se transmite en vivo (ver "diferido").

---

**Stack:** React + Vite + TS + Tailwind + framer-motion (frontend) · Node + Express + TS (backend) · Postgres + Realtime vía Supabase. Monorepo con workspaces npm, todo en Docker para dev.

---

## Correr local (Docker, aislado)

Todo corre en contenedores: **no se instala Node ni dependencias en la Mac**. (El root `package.json` usa workspaces; el código real se monta por volumen, con hot reload vía `tsx watch` / Vite.)

1. Crear `.env` en la raíz copiando `.env.example` y completar credenciales (incluidas las `LETTERBOXD_URL_*`).
2. En Supabase, ejecutar `backend/db/schema.sql` en el SQL editor (incluye la migración del pozo persistente).
3. `docker compose up` → backend en `:3001`, frontend en `:5173`.
4. Abrir http://localhost:5173

**Comandos** (el root no tiene script `test`/`build`; apuntar al workspace):
- Tests backend: `docker compose run --rm --workdir /app/backend backend npm test`
- Un archivo: `docker compose run --rm --workdir /app/backend backend npx vitest run src/<archivo>.test.ts`
- Build/typecheck backend: `docker compose run --rm --workdir /app/backend backend npm run build`
- Typecheck/build frontend: `docker compose run --rm --workdir /app/frontend frontend npx tsc -b` / `... npm run build`
- Frenar: `docker compose down` · Reinstalar deps nuevas: `docker compose build`

> Nota: tras editar código del backend, `tsx watch` recarga solo. Si dudás de qué versión corre, `docker compose down && docker compose up`.

---

## Variables de entorno

| Variable | Dónde | Notas |
|---|---|---|
| `TMDB_API_KEY` | backend | API key de TMDB |
| `SUPABASE_URL` | backend | Project URL, **sin** `/rest/v1/` |
| `SUPABASE_SERVICE_ROLE_KEY` | backend | secret key (`sb_secret_...`), bypassa RLS |
| `APP_PASSPHRASE` | backend | frase secreta de acceso |
| `PORT` | backend | `3001` |
| `LETTERBOXD_URL_JO` | backend | URL de la watchlist pública de Jo |
| `LETTERBOXD_URL_VALE` | backend | URL de la watchlist pública de Vale |
| `VITE_APP_NAME` | frontend | nombre visible |
| `VITE_API_URL` | frontend | URL del backend (**sin** barra final) |
| `VITE_SUPABASE_URL` | frontend | Project URL, **sin** `/rest/v1/` |
| `VITE_SUPABASE_ANON_KEY` | frontend | publishable key (`sb_publishable_...`) |

---

## Deploy

Tres piezas, tres lugares (orden: Supabase → Backend → Frontend):
- **DB:** Supabase. Ejecutar `backend/db/schema.sql` (la migración del pozo persistente desacopla `watchlist_items` de sesiones — correr una vez).
- **Backend:** Render (o Railway). Root Directory `backend`, build `npm install --include=dev && npm run build`, start `npm start`. Setear todas las variables de backend, **incluidas `LETTERBOXD_URL_*`**.
- **Frontend:** Vercel. Root Directory `frontend`, framework Vite. Setear las `VITE_*`. **Redeploy al cambiar variables** (se hornean en el build).

Regla mnemónica: `VITE_*` → Vercel; todo lo demás → Render.

---

## Diferido / fuera de alcance

- **Carga manual de títulos y CSV:** eliminados (antes existía un `/import` con textarea; lo reemplazó el scrape).
- **UI para editar las URLs de Letterboxd:** no hay; se setean por env.
