# TheCinematicUs — Design Brief (para prototipo en Claude design)

> Documento autónomo: describe toda la app (concepto, pantallas, estados,
> interacciones, comportamientos en vivo y datos) para diseñar el prototipo sin
> necesidad de leer el código. El frontend actual es **funcional, no diseñado**
> (dark mode básico, Tailwind); este doc es la base para rediseñarlo.

---

## 1. Qué es

App de **matching de películas estilo Tinder, para una pareja**. Cada una swipea
películas de su "pozo" (la unión de las watchlists públicas de Letterboxd de las
dos). Cuando **las dos likean la misma peli**, hay **match**. Al final eligen una
de los matches para ver esa noche.

Una frase: *"Tinder de películas para dos, para decidir qué ver esta noche sin pelear."*

---

## 2. Usuarias, contexto y tono

- **Exactamente dos usuarias fijas: Jo y Vale** (una pareja). No hay registro ni
  cuentas; se elige "quién sos" y listo. Avatares: hoy solo la inicial (J / V),
  pensados para reemplazar por foto.
- **Contexto de uso:** de noche, en el sillón, decidiendo qué ver. 3–4 veces por
  semana. Cada una en su teléfono, en la misma pieza.
- **Tono deseado:** íntimo, cálido, divertido, "noche de pelis en pareja". Hoy es
  oscuro y sobrio; hay libertad para darle personalidad (acogedor/cine/romántico
  sin ser cursi). Idioma: **español** (rioplatense/chileno informal).
- **Acento de color actual:** rosa/rose (`rose-600`) sobre fondo casi negro
  (`neutral-950`). Se puede cambiar por completo.

---

## 3. Plataforma y principios

- **Mobile-first, vertical, una mano.** Se usa en el teléfono. (Web app; no app nativa.)
- Gesto central: **swipe de cards** (arrastrar izquierda = descartar, derecha = me gusta) + botones.
- **En vivo entre los dos teléfonos** (presencia, matches, nueva sesión, filtros) — el diseño debería comunicar bien estos eventos sincronizados.
- Marca: el repo se llama **TheCinematicUs**; el título en la app hoy dice
  "MovieMatch" (placeholder configurable). El naming/branding es decisión de diseño.

---

## 4. Mapa de navegación

```
Gate (frase secreta)
   └─> ¿Quién sos? (Jo / Vale)
          └─> Swipe (pantalla principal)  ⇄  Watchlists (refrescar pozo)
                 ├─ overlay: ¡Match! (en vivo)
                 ├─ overlay: Matches de la noche  ─> ¿Cuál vemos? (Ruleta / Ronda)
                 └─ pantalla: ¡Esta noche ven! (resultado elegido)
```
La elección de usuaria se recuerda; al volver entra directo a Swipe.

---

## 5. Pantalla por pantalla

### 5.1 Gate — entrada por frase secreta
- **Propósito:** el link es público; una frase compartida lo mantiene privado.
- **Contenido:** título/logo de la app, un input tipo password ("Frase secreta"),
  botón **Entrar**. Error inline "Frase incorrecta" si falla.
- **Estados:** vacío / escribiendo / error.
- Es la primera impresión de marca — buen lugar para el logo y el tono.

### 5.2 ¿Quién sos? — elegir usuaria
- **Propósito:** identificarse como Jo o Vale (sin login).
- **Contenido:** título "¿Quién sos?", dos tarjetas grandes lado a lado con
  avatar (inicial hoy; foto a futuro) y el nombre.
- **Interacción:** tocar una entra a Swipe. Se recuerda la elección.

### 5.3 Swipe — pantalla principal (el corazón de la app)
Es donde se pasa casi todo el tiempo. Layout vertical:

**Header (arriba):**
- Izquierda: nombre de la usuaria actual + link chico "cambiar".
- Derecha: **🎬 Watchlists**, **🔄 Nueva sesión**, **❤️ {n}** (contador de matches, abre la lista).

**Presencia (debajo del header):** una línea chica con el estado de **la otra**:
punto de color + "Vale: swipeando / en línea / terminó su mazo / desconectada".
(Es presencia en vivo, no expone likes.)

**Barra de filtros (plegable):** botón **☰ Filtros** (se marca si hay filtro
activo). Al abrir: un **slider de duración máxima** (60–240 min, o "sin límite") y
**chips de géneros para excluir** (los que existen en el mazo; tocados = excluidos,
tachados). El filtro es **compartido**: lo que pone una, se aplica a las dos en vivo.

**Contador:** texto chico "12 pelis por ver" (cantidad restante en el mazo).

**Card central (el mazo):** una pila de cards arrastrables. La card de arriba se
arrastra a izquierda (descartar) o derecha (me gusta), con rotación/opacidad al
arrastrar. **Tocar la card** la expande para ver más detalle (ver §7 los campos).

**Botón ↩ Deshacer:** aparece **solo después de un descarte** (no tras un like),
arriba de los botones. Trae la última card de vuelta. (Un like que matcheó no se
deshace, como en apps de citas.)

**Botones de acción (abajo):** ✕ (descartar, neutro) y ✓ (me gusta, color acento),
grandes y redondos.

**Estados de la pantalla:**
- *Cargando mazo.*
- *Swipeando* (hay cards).
- *Reiniciando mazo…* (transición de nueva sesión, ver §6).
- *Mazo vacío:* "No quedan películas por swipear" + (si hay matches) botón "Ver N
  matches" + sugerencia "Actualizá las watchlists".

### 5.4 Watchlists — refrescar el pozo
- **Propósito:** traer/actualizar las películas desde las watchlists de Letterboxd.
  Corre automático a diario; este botón es el override manual.
- **Contenido:** título, explicación, botón **Actualizar watchlists**, botón
  **Empezar a swipear**.
- **Estados (en vivo):**
  - *Idle:* listo para actualizar.
  - *Actualizando en segundo plano…* (responde al toque y sigue en background).
  - *Listo:* resultado por usuaria ("Jo: 203 ✓", "Vale: 188 ✓") y "re-enriquecidas: N".
  - *Error:* "Jo: error — se mantuvo la lista anterior".
- El estado llega por tiempo real (puede actualizarse aunque el refresh lo haya
  disparado el cron o la otra persona).

### 5.5 Overlay ¡Match! — celebración en vivo
- **Propósito:** cuando las dos likean la misma peli, aparece **en ambas pantallas
  al instante**.
- **Contenido:** fondo oscurecido, "**¡Match!**" grande, póster + título de la peli,
  y dos botones: **Seguir buscando** y **Ver esta**.
- "Ver esta" lleva a la pantalla de resultado (§5.7). "Seguir buscando" cierra el overlay.
- Aparece de a uno (cola de matches no vistos). **Es el momento más emotivo de la
  app — candidato a animación/celebración.**

### 5.6 Overlay Matches de la noche — la lista
- **Propósito:** ver todos los matches de la sesión y, si hay varios, decidir.
- **Contenido:** título "Matches de esta noche", grilla de pósters (2 columnas) con
  título. Botón Cerrar.
- **Si hay ≥2 matches:** arriba, botón **🎲 ¿Cuál vemos?** → abre el decididor (§5.8).
- Vacío: "Todavía no hay matches."

### 5.7 Pantalla ¡Esta noche ven! — el resultado
- **Propósito:** la peli elegida para ver (por match directo o por el decididor).
- **Contenido:** "🎬 ¡Esta noche ven!", póster grande, título (año), un 🍿, y botones
  **Volver a elegir** y **Nueva sesión**.
- Es la pantalla de "ganador" — celebratoria, cierre del ritual.

### 5.8 MatchDecider — ¿Cuál vemos? (ruleta + ronda)
Overlay con un menú y dos modos para elegir entre los matches:
- **Menú:** dos botones grandes — **🎰 Ruleta** y **⚔️ Ronda** — y volver/cerrar.
- **Ruleta:** grilla de pósters; un "resaltado" cicla entre ellos y **desacelera
  hasta caer en uno al azar**. Revela la ganadora (🎬 título) + **Ver esta** /
  **Girar de nuevo**. *Candidato fuerte a animación divertida (giro/casino).*
- **Ronda ("esto o lo otro"):** muestra **dos pósters enfrentados** ("Comparación 1
  de 4"); tocás la que preferís y la otra queda eliminada; sigue contra la
  siguiente hasta que queda una. Al final: 🏆 ganadora + **Ver esta** / **Otra vez**.
- Resultado → pantalla §5.7.

---

## 6. Comportamientos en vivo (Realtime) — importantes para el diseño

La app sincroniza eventos entre los dos teléfonos; el diseño debería hacerlos legibles:
- **Presencia:** ver si la otra está en línea / swipeando / terminó (§5.3).
- **Match:** el overlay ¡Match! aparece en ambas al instante (§5.5).
- **Nueva sesión (noche nueva):** cuando una toca "Nueva sesión", la otra ve un
  **banner de transición de 2 fases**: "♻️ {quién} empezó una noche nueva ·
  reiniciando mazo…" → "✓ Mazo nuevo listo". Mientras tanto el mazo muestra
  "Reiniciando mazo…". (El que la inicia ve "Empezaste una noche nueva".)
- **Cambio de filtro:** cuando una cambia el filtro, la otra ve un aviso efímero
  "{quién} cambió el filtro" y su mazo se reordena.
- **Refresh de watchlists:** el estado (actualizando → listo) llega en vivo (§5.4).

Patrón visual a definir: estos **avisos/banners efímeros** (hoy son chips arriba)
merecen un tratamiento consistente.

---

## 7. Qué muestra una card de película (datos disponibles)

Todos vienen de TMDB; algunos pueden faltar (diseñar estados sin póster, sin rating, etc.):
- **Póster** (imagen vertical 2:3; puede faltar → placeholder).
- **Título** y **año**.
- **Duración** (ej. "1h 52min").
- **Rating** TMDB (ej. "⭐ 7.8").
- **Géneros** (chips: Drama, Comedia, Terror…).
- **País**.
- Al expandir (tocar la card): **Dirección**, **Reparto** (hasta 5), **Sinopsis**.

El "match" y el resultado muestran póster + título principalmente.

---

## 8. Estado actual vs. oportunidades de diseño

- **Hoy:** dark mode plano, acento rosa, tipografía del sistema, cero ilustración,
  emojis como íconos. Funciona pero es "de programador".
- **Oportunidades (orden de impacto emotivo):**
  1. **Momento ¡Match!** (§5.5) — celebración/animación.
  2. **Card de swipe** (§5.3) — el objeto central; jerarquía, gesto, feedback.
  3. **Ruleta/Ronda** (§5.8) — juego, animación.
  4. **Pantalla ¡Esta noche ven!** (§5.7) — cierre celebratorio.
  5. **Identidad/marca:** logo, nombre, paleta, avatares (Jo/Vale con foto), Gate.
  6. **Banners/avisos en vivo** (§6) — sistema consistente.

---

## 9. Glosario

- **Pozo:** la unión de las películas de las dos watchlists; las cards a swipear.
- **Sesión / noche:** una ronda de swipes. "Nueva sesión" resetea swipes y matches
  (el pozo persiste). Solo una sesión activa a la vez, compartida.
- **Match:** una peli que **las dos** likearon en la misma sesión.
- **Descartar / pass:** swipe a la izquierda (no me interesa hoy).
- **Decididor:** ruleta o ronda para elegir entre varios matches.

---

## 10. Inventario de pantallas para el prototipo (checklist)

1. Gate (frase secreta)
2. ¿Quién sos? (Jo / Vale)
3. Swipe — con card, filtros, contador, presencia, undo, botones
4. Swipe — estado mazo vacío
5. Swipe — banner de nueva sesión (reiniciando → listo)
6. Watchlists — idle / actualizando / listo / error
7. Overlay ¡Match!
8. Overlay Matches de la noche (grilla + "¿Cuál vemos?")
9. MatchDecider — menú
10. MatchDecider — Ruleta (girando + resultado)
11. MatchDecider — Ronda (comparación + ganadora)
12. ¡Esta noche ven! (resultado)
