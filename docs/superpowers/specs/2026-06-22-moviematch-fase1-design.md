# MovieMatch — Diseño Fase 1

**Fecha:** 2026-06-22
**Estado:** Aprobado para implementación
**Alcance:** Fase 1 (MVP). Las Fases 2 (scraping de Letterboxd) y 3 (modos de matching, historial con ratings, filtro "ya la vimos") tendrán cada una su propia spec.

> El nombre **MovieMatch** es provisorio (candidatos: Coincine, Duet, ¿Qué Vemos?). Debe quedar parametrizado en un solo lugar para cambiarlo en una línea.

---

## 1. Contexto y objetivo

Webapp personal para que dos personas (Jo y Vale) decidan qué película ver, estilo "swipe" tipo Tinder. Cuando ambas dan like a la misma película, hay **match**. El problema que resuelve: decidir sin que una se sienta influenciada por la opinión de la otra.

**Principio central de producto — privacidad de likes:** una usuaria NUNCA debe ver qué likeó la otra hasta que haya match. Esto se garantiza **por diseño** (el frontend no tiene forma de leer los swipes ajenos), no por confianza en la UI.

**Principio central de producto — el match es ocasional:** un like es del momento, según las ganas de esa noche. No es un estado permanente. Cada sesión (= una noche de películas) arranca de cero.

Es una app privada para dos usuarias. No se comercializa ni comparte.

---

## 2. Stack

- **Frontend:** React + Vite + TypeScript, Tailwind CSS, framer-motion (animaciones de swipe).
- **Backend:** Node.js + Express + TypeScript. Dueño de la TMDB API key; resuelve/cachea TMDB, registra swipes, detecta matches.
- **DB:** Postgres vía Supabase.
- **Realtime:** Supabase Realtime — el frontend se suscribe **solo** a la tabla `matches`.
- **Deploy:** Vercel (frontend) + Railway/Render (backend) + Supabase (DB).

### Decisión de arquitectura: detección de match en el backend

Los swipes se escriben vía Express (`POST /swipe`). Express detecta el match y lo inserta en `matches`. El frontend se suscribe por Supabase Realtime únicamente a `matches`. El frontend **no tiene credenciales ni endpoint para leer los swipes de la otra usuaria** → la privacidad de likes queda garantizada por diseño.

(Alternativas descartadas: trigger de Postgres — mete lógica de negocio en SQL, más difícil de debuggear; comparación en el frontend — filtraría los likes.)

**RLS (refuerzo de la privacidad):** como el frontend usa la anon key de Supabase para suscribirse a Realtime, hay que activar Row Level Security para que la anon key **no pueda leer `swipes` ni `watchlist_items`**. El frontend solo puede leer `matches` y `movies`. La escritura de swipes y la lectura cruzada las hace el backend con la **service role key** (que nunca sale del backend). Así la privacidad de likes no depende solo de "no hay endpoint", sino que está bloqueada a nivel de DB.

---

## 3. Estructura del proyecto

Monorepo con workspaces:

```
/MovieMatch
  /frontend          React + Vite + TS + Tailwind + framer-motion
    /src
      config.ts       APP_NAME y constantes (lee VITE_APP_NAME)
  /backend           Node + Express + TS
  package.json       raíz; script `dev` corre frontend y backend con concurrently
  .env.example
  README.md          instrucciones de deploy (Vercel + Railway/Render + Supabase)
```

- El frontend habla con Express (REST) para todos los datos, y con Supabase JS **solo** para suscribirse a Realtime de `matches`.
- **Nombre parametrizado:** `VITE_APP_NAME` (env) + `frontend/src/config.ts`. Cambiar el nombre = una línea.
- Comando local único: `npm run dev` en la raíz levanta ambos.

---

## 4. Modelo de datos (Supabase Postgres)

- **`users`** — seed con 2 filas fijas:
  - Jo, avatar 🐭 (ratón)
  - Vale, avatar 🦆 (pato)
  - Campos: `id`, `name`, `avatar_emoji`.

- **`movies`** — cache de TMDB (una peli ya resuelta no se vuelve a pedir):
  - `id`, `tmdb_id` (nullable), `title`, `original_title`, `year`, `poster_url`, `director`, `cast` (jsonb, top 4–5), `runtime` (min), `genres` (jsonb), `overview`, `tmdb_rating`, `country`, `enriched` (bool).
  - Si TMDB no matchea: se guarda igual con `title` + `year` y `enriched=false`.

- **`sessions`** — una sesión = una noche de películas:
  - `id`, `mode` (Fase 1 siempre `'pool'` = pozo común), `active` (bool), `created_at`.
  - Botón "nueva sesión" disponible; los modos múltiples llegan en Fase 3.

- **`watchlist_items`** — qué pelis trajo cada usuaria a la sesión:
  - `id`, `session_id`, `user_id`, `movie_id`.

- **`swipes`** — `id`, `session_id`, `user_id`, `movie_id`, `liked` (bool), `created_at`.
  - Único por `(session_id, user_id, movie_id)`.
  - **Scope por sesión:** los swipes pertenecen a una sesión. Una sesión nueva no arrastra swipes viejos.

- **`matches`** — `id`, `session_id`, `movie_id`, `created_at`.
  - Único por `(session_id, movie_id)`.
  - Puede haber **varias** filas por sesión (los matches se acumulan).
  - En Fase 1 esta tabla también sirve de registro histórico básico. Ratings post-función ("ya la vimos" + estrellas) → Fase 3.

---

## 5. Comportamiento de sesiones (el match es ocasional)

- Cada noche que se juntan, arrancan una **sesión nueva**: el mazo se resetea y swipean de cero según el ánimo de hoy.
- Un like de una sesión pasada **no se arrastra** a la nueva.
- **Dentro de la misma sesión** el estado persiste: pueden pausar y retomar la misma noche sin perder lo swipeado.
- Los matches de sesiones viejas quedan como registro, pero **no condicionan** una sesión nueva — una peli vuelve a aparecer en el mazo si no la swipeaste en la sesión actual.
- Por defecto **todas** las pelis reaparecen en cada sesión. El filtro "ya la vimos" para esconder pelis ya vistas → Fase 3.

---

## 6. Flujo de la app (pantallas)

1. **Gate de acceso** — passphrase compartida (env var del backend). Al validar, se guarda un token en `localStorage`. La URL es pública (Vercel); esto mantiene el link privado.
2. **Elegir usuaria** — "Soy Jo 🐭" / "Soy Vale 🦆".
3. **Importar watchlist** — textarea, un `Título (Año)` por línea. (En Fase 1 es manual; el scraping de Letterboxd es Fase 2.) El backend resuelve cada título contra TMDB y lo cachea.
4. **Swipe** — mazo = **unión** de ambas listas (pozo común). Card mobile-first:
   - Poster ocupa ~60% del alto.
   - Debajo: título + año + duración (formato "1h 47min") + géneros (chips) + puntaje TMDB.
   - Tap sobre la card: expande sinopsis completa + director + cast.
   - Swipe derecha = like, izquierda = pass. Botones 👍 / 👎 además del gesto.
   - Animación suave (framer-motion).
   - Estética oscura por defecto (uso nocturno), tipografía limpia, posters protagonistas. Inspiración: Letterboxd + Tinder.
   - **Contador de matches visible** mientras swipeás (ej. "❤️ 3"), tocable para abrir la lista de matches en cualquier momento.
   - Pantalla de sincronía: si la otra todavía no terminó, "Vale sigue eligiendo… 🦆" / "Jo sigue eligiendo… 🐭" (nunca error ni vacío).
5. **Match (en vivo)** — en el momento en que ambas likean la misma peli, salta un overlay en **ambas** pantallas (Supabase Realtime) con poster grande + título + 🐭🦆 celebrando. Botones:
   - **"Ver esta"** — la eligen (registro), termina/pausa la sesión.
   - **"Seguir buscando"** — cierra el overlay y siguen swipeando. Los matches se **acumulan**.
6. **Lista de matches** — accesible **en cualquier momento** desde el contador ❤️ (no es un gate de fin de mazo). Muestra todas las coincidencias de la sesión hasta el momento para elegir cuál ver. No hace falta terminar la watchlist completa.

---

## 7. Endpoints del backend (Express)

Todos pasan por un middleware que valida la passphrase.

- **`POST /import`** — recibe los títulos de una usuaria (`user`, lista de `título (año)`). Para cada uno: busca en cache; si no está, resuelve contra TMDB y cachea; crea `watchlist_items`. Devuelve el resultado del import (resueltos / con datos mínimos).
- **`GET /deck?user=&session=`** — devuelve el mazo pendiente de esa usuaria en la sesión activa (pelis de la unión que aún no swipeó).
- **`POST /swipe`** — registra `{session, user, movie, liked}`. Si `liked` y la otra usuaria también likeó esa peli en la sesión → inserta en `matches`.
- **`GET /matches?session=`** — lista de matches de la sesión (para la pantalla de matches).
- **`POST /session`** — crea una sesión nueva (resetea el mazo).

### Integración con TMDB

- API key en `TMDB_API_KEY` (solo en el backend).
- `/search/movie` para resolver `título + año → tmdb_id`.
- `/movie/{id}?append_to_response=credits` para director + cast en una sola llamada.
- `image.tmdb.org` para posters (alta resolución, vertical).
- **Cache agresivo en la DB:** una peli resuelta no se vuelve a pedir.

---

## 8. Manejo de errores y bordes

- **TMDB sin match** (título raro, año equivocado, peli oscura): se guarda con título + año, `enriched=false`. La card se muestra igual con datos mínimos (sin poster ni metadata). No se rompe el flujo ni se excluye del mazo.
- **TMDB rate limit / caída:** reintento con backoff. Si falla, la peli queda `enriched=false`; el import no se corta.
- **Ambigüedad en `/search/movie`** (varios resultados): tomar el mejor match por título + año; comentar en español el criterio elegido.
- **Cache:** chequear cache antes de cada llamada a TMDB.

---

## 9. Entregables de Fase 1

1. Estructura del monorepo + `npm run dev` para correr todo localmente.
2. Schema SQL de Supabase (las tablas de la sección 4) + seed de las 2 usuarias.
3. Backend Express con los endpoints de la sección 7 (import + TMDB enrichment + swipes + detección de match + sesiones).
4. Frontend funcional con las pantallas de la sección 6: gate → elegir usuaria → importar → swipe → match en vivo → lista de matches.
5. README con instrucciones de deploy a Vercel + Railway/Render + Supabase.
6. `.env.example` con todas las variables: `TMDB_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (backend), `APP_PASSPHRASE`, `VITE_APP_NAME`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, URL del backend.

---

## 10. Convenciones de trabajo

- Implementación incremental; commits frecuentes y atómicos.
- Comentarios en español en las partes no obvias (matching de TMDB, detección de match, lógica de sesiones).
- Si una librería sugerida no es la mejor opción en 2026, proponer alternativa antes de usarla.

---

## 11. Explícitamente fuera de alcance (Fase 1)

- Scraping de Letterboxd e import por CSV → **Fase 2**.
- Modo intersección (solo pelis en ambas watchlists) → **Fase 3**.
- Historial con "ya la vimos" + ratings (1–5 estrellas) post-función → **Fase 3**.
- Filtro para esconder pelis ya vistas en futuros mazos → **Fase 3**.
- Puntaje de Letterboxd (se extrae del scraping) → **Fase 2/3**.
- Login complejo / multiusuario más allá de Jo y Vale.
