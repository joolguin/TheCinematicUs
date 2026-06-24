# TheCinematicUs — Propuesta de evolución (v2, revisada)

> Revisión de la propuesta original aplicando criterio de escala real:
> 2 usuarias, ~200 películas por watchlist, uso 3–4 noches/semana, free tier.
> Principio que ordena todo: **a esta escala, complejidad que no compre algo hoy es deuda, no robustez.**

---

## 0. El encuadre que la v1 no decía

El problema central no es técnico, es de **inventario**. Dos watchlists de ~200, ven una peli por semana. Todo lo demás —cooldowns, filtros, orden por novedad— **reordena un mazo chico, no lo agranda**. Sirve, pero tiene techo. Conviene tenerlo presente para no sobre-invertir en maquinaria de reordenamiento creyendo que resuelve el "loop de las mismas cards".

Dos consecuencias:
1. Las mejoras de §2 y §3.1 valen, pero con expectativa realista: hacen la sesión más usable, no infinita.
2. La palanca de techo —si algún día el loop molesta de verdad— es **ampliar la fuente** (listas de Letterboxd además de la watchlist, o sugerencias por disponibilidad en streaming fuera del pozo). Eso es scope de producto y queda fuera de este plan, anotado como salida futura.

---

## 1. Lo que entra (ordenado por hacer primero)

### 1.1 Bugs que ya están latentes — arreglar antes que cualquier feature
- **`search_key` debe ser índice, no `unique`.** Dos pelis con mismo título+año existen; `tmdb_id` es la verdad. El `unique` actual puede romper resolución legítima. (era §8)
- **Umbral de replace-on-success por diff, no `≥1`.** Hoy una página degradada con 1 sola peli borra el set entero. Cambiar a: si el diff con el set anterior supera X% (ej. 40%), **mantener el set viejo y alertar**, no reemplazar. (era §6)

### 1.2 Privacidad — convertir la invariante en algo testeable
Hoy la privacidad de likes depende de la **ausencia** de policies anon en `swipes`/`watchlist_items`. Se rompe con una línea en el SQL editor.
- Policies **DENY explícitas** (fail-closed visible) en vez de ausencia.
- **Test de integración** que abre un cliente con la anon key, intenta leer `swipes` y `watchlist_items`, y **falla el build si devuelve filas**. Esto es lo más barato y de mayor retorno del documento. (era §5)

### 1.3 Quick wins de modelo
- **`letterboxd_url` como columna de `users`.** Sacarla de env (`LETTERBOXD_URL_JO/_VALE`). Cambiar URL deja de requerir redeploy. (era §3.5)
- **`fetched_at` en `movies` + `last_enrich_attempt_at` con backoff.** Reemplaza el `enriched=false` permanente sin reintentos por un estado con vencimiento y retry. **Sin** partir la tabla (ver §3 Descartado). (era §3.3 parcial)

### 1.4 Filtros pre-sesión
Selector simple al iniciar (runtime, géneros; "en streaming" si la metadata lo permite) que reduce el deck. Ya hay metadata rica de TMDB sin usar. **Mayor impacto, menor esfuerzo, no toca el modelo.** Único matiz: el mazo ya es chico, filtrar de más deja sesiones vacías → pensar mínimos/aviso de "deck vacío con estos filtros". (era §2.2)

### 1.5 Refresh asíncrono + cron diario
- `/watchlists/refresh` devuelve **202 inmediato**; el scrape corre en background; el frontend escucha por **Realtime** (infra ya montada) cuando termina.
- **Cron diario** (ej. 18:00) que refresca solo. El botón manual queda como override. Elimina el "se olvidaron de refrescar" y el spinner contra cache fría + free tier. (era §7)

### 1.6 Motor de novedad — `user_movie_state` (al final, con expectativa acotada)
Tabla de estado acumulado por usuaria, cruza sesiones:
```
user_movie_state (
  user_id, movie_id,
  last_passed_at, pass_count, last_liked_at,
  PRIMARY KEY (user_id, movie_id)
)
```
Habilita cooldown de pelis pasadas N veces y **orden del deck por novedad**. Requiere `first_seen_at`/`last_seen_at` en `watchlist_items` para distinguir pelis nuevas de estancadas. Toca el path de escritura de swipe + un backfill. Va último porque es el de más superficie y el de retorno más sujeto al techo de inventario. (era §3.1 + §3.2 parcial)

---

## 2. Verificar ANTES de comprometer (no asumir)

- **RSS de watchlist de Letterboxd (era §6, plan A).** Letterboxd tiene RSS de diary y de listas; **no me consta que `/watchlist/rss/` exista**. Antes de planificarlo como fuente alternativa: `curl` y confirmar. Si no existe, el plan B (import por CSV) sube a plan A. No lo meto en el plan firme hasta verificar.
- **`sessions.outcome = watched` (era §3.4).** ¿Cómo se sabe que la vieron? Requiere UI de confirmación post-sesión que hoy no existe. Si no se va a construir, agregar solo `ended_at` y derivar `matched`/`abandoned` de si hubo match — no inventar un campo que nunca se va a poblar bien.

---

## 3. Descartado a esta escala (y por qué)

- **Partir `movies` / `movies_extended` con lazy load (era §3.3).** Sobre-ingeniería para ~400 filas y 2 usuarias. Una fila de TMDB entra holgada. Solo `fetched_at` + retry.
- **Crons de limpieza / borrar `movies` (era §4.1).** El volumen es ruido a esta escala. Borrar pelis "porque se recachean barato" mete riesgo de rate limits de TMDB y complejidad para ahorrar storage gratis. **Conservar `movies`.** A lo sumo, expirar sesiones viejas si molesta el orden — sin urgencia.
- **`watchlist_history` con eventos added/removed (era §3.2, parte opcional).** `first_seen_at`/`last_seen_at` en `watchlist_items` ya da lo que se necesita (novedad). La tabla de historia no responde ninguna pregunta concreta hoy.

---

## 4. UX chico (oportunista, no bloquea)
- **Undo en swipe.** Estándar mobile; un toque mal pierde la peli hasta la próxima noche. (era §8)
- **Contador de cards restantes.** Cambia la psicología del swipe. (era §8)

---

## 5. Operacional
- **Anti-cold-start de Render acotado a la ventana de uso.** Cron pingando `/auth/check`, **solo ~18:00–23:30**, no 24/7: pingear todo el día quema las 750h/mes del free tier y te puede dejar sin servicio de noche. (corrige §9)
- **FKs con `ON DELETE` explícito.** Decidir cascade/restrict/set null para `swipes.movie_id`, `matches.movie_id`, `watchlist_items.movie_id` ahora, no por default. (era §9)

---

## 6. No tocar (estaba bien en la v1)
- Backend como único dueño de credenciales y de lectura cruzada.
- Scraper aislado en `letterboxd.ts`.
- Índice único parcial `one_active_session`.
- `watchlist_items` desacoplada de sesiones (pozo persiste, swipes no).
- Replace-on-success independiente por usuaria.
- Trampas documentadas en el README (Cloudflare, `VITE_*` horneado).

---

## 7. Orden de ejecución sugerido

| # | Cambio | Por qué acá |
|---|--------|-------------|
| 1 | `search_key` no-unique + umbral diff | Bugs latentes, no features |
| 2 | Policies DENY + test anon | Barato, blinda privacidad, base para confiar en lo demás |
| 3 | `letterboxd_url` → `users` | Trivial, saca fricción operativa |
| 4 | `fetched_at` + retry de enrich | Base de la política de refresh |
| 5 | Filtros pre-sesión | Mayor impacto/esfuerzo de las features |
| 6 | Refresh async 202 + cron diario | Elimina spinner y botón olvidado |
| 7 | `user_movie_state` + orden por novedad | Último: más superficie, retorno con techo |
| — | RSS / CSV | Solo si §2 lo verifica |

---

## Apéndice — Reglas para decidir sobre la DB (sin cambios; siguen siendo buenas)
1. ¿La UI lo muestra hoy? Si no, no guardarlo (TMDB sigue ahí).
2. ¿Cuánto dura siendo verdad? Si vence → `fetched_at` + política de refresh.
3. ¿Responde una pregunta concreta? Si la respuesta es genérica, probablemente no.
4. ¿Se pierde algo al borrar? Cache se recachea; matches confirmados no. Eso define qué proteger.
