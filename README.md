# MovieMatch (Fase 1)

App de matching de películas estilo Tinder para dos personas (Jo 🐭 y Vale 🦆). Cuando ambas dan like a la misma película, hay match en vivo en las dos pantallas.

> El nombre es provisorio. Se cambia en una sola variable: `VITE_APP_NAME` en `.env`.

## Correr local (con Docker, aislado)

Todo corre en contenedores: no se instala Node ni dependencias en tu máquina.

1. Crear `.env` en la raíz copiando `.env.example` y completar credenciales.
2. Crear el proyecto en Supabase y ejecutar `backend/db/schema.sql` en el SQL editor.
3. `docker compose up` (backend en `:3001`, frontend en `:5173`).
4. Abrir http://localhost:5173

Comandos útiles:
- Tests del backend: `docker compose run --rm backend npm --workspace backend test`
- Build del frontend: `docker compose run --rm frontend npm --workspace frontend run build`
- Frenar y limpiar: `docker compose down`
- Si agregás dependencias: `docker compose build` para reinstalarlas en la imagen.

## Variables de entorno

Ver `.env.example`. `SUPABASE_SERVICE_ROLE_KEY` y `TMDB_API_KEY` van **solo** en el backend; nunca en el frontend.

## Deploy

- **DB:** Supabase (ejecutar `backend/db/schema.sql`).
- **Backend:** Railway o Render. Setear `TMDB_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_PASSPHRASE`, `PORT`.
- **Frontend:** Vercel. Setear `VITE_APP_NAME`, `VITE_API_URL` (URL del backend), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Privacidad de likes

Ninguna usuaria ve los likes de la otra hasta que hay match. Garantizado a nivel DB: RLS impide que la anon key (frontend) lea `swipes` y `watchlist_items`; solo el backend (service role) detecta los matches.

## Alcance

Fase 1 (MVP): import manual de títulos, enriquecimiento TMDB, swipe, match en vivo, lista de matches por sesión. El scraping de Letterboxd (Fase 2) y los modos/historial con ratings (Fase 3) tienen sus propias specs en `docs/superpowers/specs/`.
