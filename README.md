# TheCinematicU 🐭🦆

App web de matching de películas estilo Tinder, para **una pareja** (Jo 🐭 y Vale 🦆), pensada para decidir qué ver sin pelear.

---

## 🎯 Objetivo

Jo y Vale quieren ver una película juntas y les cuesta decidir. Las dos usan Letterboxd y mantienen watchlists. La idea: un sistema de **swipe** donde cada una marca, en privado, qué se le antoja esa noche. Cuando **ambas** dan like a la misma película, hay **match** — y esa es la elegida.

**Dos principios de producto que guían todo:**

1. **Privacidad de los likes.** Ninguna ve qué likeó la otra hasta que hay match. El valor central es decidir **sin sentirse influenciada** por la opinión de la otra. Está garantizado a nivel de base de datos (RLS), no por confianza en la interfaz.
2. **El match es ocasional.** Un like es del momento, según las ganas de esa noche — no un estado permanente. Cada **sesión** (= una noche) arranca de cero; lo que te gustó otro día no se arrastra.

Es un proyecto personal de pareja: solo para Jo y Vale, sin comercializar ni compartir.

---

## 🌅 Visión: cómo será la app terminada

Cuando esté completa, el flujo será:

1. **Entrar** con una frase secreta compartida (la URL es pública, esto la mantiene privada).
2. **Elegir quién soy** (Jo 🐭 / Vale 🦆) con avatares de ratón y pato.
3. **Importar la watchlist** automáticamente desde el perfil público de Letterboxd (pegando la URL), con fallback a CSV y a carga manual.
4. **Enriquecer** cada película con datos de TMDB: póster, dirección, reparto, duración, géneros, sinopsis, puntaje. La card de swipe tiene **toda** la info para decidir sin abrir Letterboxd en paralelo.
5. **Elegir el modo** de la noche:
   - **Pozo común:** se unen las dos listas y ambas swipean todo.
   - **Intersección:** solo las películas que están en **ambas** watchlists.
6. **Swipear** cards estilo Tinder (gesto + botones), mobile-first, estética oscura.
7. **Match en vivo** en las dos pantallas, con animación. Los matches se **acumulan**; se ven en cualquier momento.


**Stack:** React + Vite + TS + Tailwind + framer-motion (frontend) · Node + Express + TS (backend) · Postgres + Realtime vía Supabase · Deploy en Vercel + Render + Supabase.

---

## 🗺️ Roadmap

### ✅ Fase 1 — MVP (completada)
El núcleo funcional, end-to-end y desplegado.
- [x] Monorepo (`frontend/` + `backend/`) con entorno Docker aislado.
- [x] Gate de acceso por passphrase compartida.
- [x] Selección de usuaria (Jo 🐭 / Vale 🦆).
- [x] Import **manual** de títulos (`Título (Año)` por línea).
- [x] Enriquecimiento con TMDB + cache agresivo en la DB.
- [x] Swipe (gesto + botones 👍/👎), card mobile-first oscura, sinopsis expandible.
- [x] Detección de match en el backend + **match en vivo** vía Supabase Realtime.
- [x] Lista de matches de la sesión, consultable en cualquier momento (❤️).
- [x] Sesiones efímeras + botón "Nueva sesión" siempre visible.
- [x] Pantalla de "película elegida" al tocar "Ver esta".
- [x] **Robustez:** detecta matches no vistos al entrar, aunque una se adelante.
- [x] Privacidad de likes garantizada por RLS.

> Spec y plan: `docs/superpowers/specs/2026-06-22-moviematch-fase1-design.md` · `docs/superpowers/plans/2026-06-22-moviematch-fase1.md`

### 🔜 Fase 2 — Import desde Letterboxd
Que no tengan que pegar títulos a mano.
- [ ] Scraping del perfil público de Letterboxd (pegar URL de la watchlist).
  - Rate limiting (delay 300–500ms), User-Agent identificable, respetar robots.txt, cache ≥24h.
  - Parsear título + año + slug de cada película (ej. con `cheerio`).
- [ ] Fallback: import por **CSV** (export de Letterboxd).
- [ ] Si el scraping es frágil o hay anti-bot, evaluar CSV como flujo principal.
- [ ] Extraer el puntaje de Letterboxd de cada película.

### 🔮 Fase 3 — historial y puntajes
La experiencia completa.
- [ ] Elegir **modo** al iniciar sesión: intersección vs. pozo común.

### ✨ Mejoras sueltas (cuando se quiera)
- [ ] Cosmético: `<title>` de la pestaña (dice "frontend") + favicon propio (🐭/🦆 o cine).
- [ ] Code-splitting del bundle (hoy >500kB, warning de Vite).
- [ ] Avatares por defecto / easter egg de ratón y pato en la UI.

---

## 🛠️ Correr local (con Docker, aislado)

Todo corre en contenedores: no se instala Node ni dependencias en tu máquina.

1. Crear `.env` en la raíz copiando `.env.example` y completar credenciales.
2. Crear el proyecto en Supabase y ejecutar `backend/db/schema.sql` en el SQL editor.
3. `docker compose up` (backend en `:3001`, frontend en `:5173`).
4. Abrir http://localhost:5173

Comandos útiles:
- Tests del backend: `docker compose run --rm backend npm --workspace backend test`
- Build del frontend: `docker compose run --rm frontend npm --workspace frontend run build`
- Frenar y limpiar: `docker compose down`
- Si se agregan dependencias: `docker compose build` para reinstalarlas en la imagen.

## 🔑 Variables de entorno

Ver `.env.example`. `SUPABASE_SERVICE_ROLE_KEY` y `TMDB_API_KEY` van **solo** en el backend; nunca en el frontend.

| Variable | Dónde | Notas |
|---|---|---|
| `TMDB_API_KEY` | backend | API key de TMDB |
| `SUPABASE_URL` | backend | Project URL, **sin** `/rest/v1/` |
| `SUPABASE_SERVICE_ROLE_KEY` | backend | secret key (`sb_secret_...`), bypassa RLS |
| `APP_PASSPHRASE` | backend | frase secreta de acceso |
| `PORT` | backend | `3001` |
| `VITE_APP_NAME` | frontend | nombre visible de la app |
| `VITE_API_URL` | frontend | URL del backend |
| `VITE_SUPABASE_URL` | frontend | Project URL, **sin** `/rest/v1/` |
| `VITE_SUPABASE_ANON_KEY` | frontend | publishable key (`sb_publishable_...`) |

## 🚀 Deploy

Tres piezas en tres lugares (orden: Supabase → Backend → Frontend):
- **DB:** Supabase (ejecutar `backend/db/schema.sql`).
- **Backend:** Render o Railway. Root Directory `backend`, build `npm install --include=dev && npm run build`, start `npm start`. Setear las variables de backend.
- **Frontend:** Vercel. Root Directory `frontend`, framework Vite. Setear las variables `VITE_*`. Recordar **redeploy** al cambiar variables (se hornean en el build).

## 🔒 Privacidad de likes

Ninguna usuaria ve los likes de la otra hasta que hay match. Garantizado a nivel DB: RLS impide que la anon key (frontend) lea `swipes` y `watchlist_items`; solo el backend (service role) hace la lectura cruzada y detecta los matches. El frontend solo se suscribe a la tabla `matches` por Realtime.

## 🧩 Arquitectura (resumen)

- **Frontend (Vercel):** habla con el backend por REST; usa Supabase JS **solo** para el Realtime de `matches`.
- **Backend (Render):** dueño de las keys privadas (TMDB, service role). Resuelve/cachea TMDB, registra swipes, detecta matches, maneja sesiones.
- **DB (Supabase):** Postgres + Realtime. Tablas: `users`, `movies` (cache TMDB), `sessions`, `watchlist_items`, `swipes`, `matches`.
