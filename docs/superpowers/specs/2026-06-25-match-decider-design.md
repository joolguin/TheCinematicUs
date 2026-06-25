# Decidir qué match ver (ruleta + ronda) — Diseño

> Spec para el Milestone 8 (UX, frontend puro). Con varios matches en una noche,
> ayuda a elegir cuál ver: una ruleta al azar o una ronda "esto o lo otro".

## 1. Objetivo y contexto

Usando la app con varios matches en una sesión, decidir cuál ver fue difícil.
Se agregan dos modos de decisión, ambos **frontend puro** (los matches ya vienen
de `/matches`; no hace falta backend, DB ni Realtime):
- **Ruleta:** elige uno al azar con una animación de giro.
- **Ronda:** "esto o lo otro" por pares (rey de la colina) hasta que queda uno.

Decisiones acordadas:
- **Un solo teléfono** (deciden juntos mirándolo). Sin sincronización entre los dos.
- La ronda es **rey de la colina**: la campeona se compara contra la siguiente;
  la elegida pasa a ser campeona; sigue hasta que no quedan retadoras (N-1
  comparaciones).
- El resultado de cualquiera de los dos modos alimenta la pantalla final
  **"¡Esta noche ven!"** que ya existe (`onChoose` → `chosen` en `Swipe.tsx`).

## 2. Componente `MatchDecider`

Archivo nuevo `frontend/src/components/MatchDecider.tsx`. Overlay fullscreen,
estado de modo interno.

Props:
```ts
{ matches: Movie[]; onPick: (m: Movie) => void; onClose: () => void }
```

Estado: `mode: 'menu' | 'ruleta' | 'ronda'`.

### 2.1 Menú
Dos botones grandes: **🎰 Ruleta** y **⚔️ Ronda**, más **Cerrar** (→ `onClose`).

### 2.2 Ruleta
- Al iniciar, elige `winnerIdx = Math.floor(Math.random() * matches.length)` y
  anima un "resaltado" que cicla por los posters, **desacelerando**, hasta caer
  en `winnerIdx`.
- Implementación (sin libs extra): un `highlight` (índice) que avanza por
  `setTimeout` con delay creciente; total de pasos `= matches.length * 3 +
  winnerIdx`, así `total % length === winnerIdx` → aterriza en el ganador tras
  ~3 vueltas.
```ts
function spin() {
  const winnerIdx = Math.floor(Math.random() * matches.length);
  setResult(null);
  const total = matches.length * 3 + winnerIdx;
  let i = 0;
  const step = () => {
    setHighlight(i % matches.length);
    if (i >= total) { setResult(matches[winnerIdx]); return; }
    i++;
    setTimeout(step, 60 + (i / total) * 240); // delay creciente = desacelera
  };
  step();
}
```
- Render: grilla/fila de posters con el `highlight` resaltado (ring + scale).
  Cuando `result` está seteado: "🎬 {title}" + **Ver esta** (→ `onPick(result)`)
  y **Girar de nuevo** (`spin()`).

### 2.3 Ronda (rey de la colina)
- `pool` = `matches` mezclado una vez (`useState(() => [...matches].sort(() => Math.random() - 0.5))`).
- `champion` = `pool[0]` (state); `pos` = 1 (índice de la retadora actual, state).
- Mientras `pos < pool.length`: mostrar **campeona vs `pool[pos]`** (dos posters
  tocables). Al tocar la preferida `w`: `setChampion(w); setPos(pos + 1);`.
- Cuando `pos >= pool.length`: `champion` es la ganadora → "🏆 {title}" +
  **Ver esta** (→ `onPick(champion)`) y **Otra vez** (reinicia la ronda).
- Mostrar progreso ("Comparación 2 de 4") es opcional pero ayuda.

(N=2 → una sola comparación; el botón ↩/Cerrar siempre vuelve al menú o cierra.)

## 3. Integración

### 3.1 `MatchesList.tsx`
- Nueva prop: `onChoose: (m: Movie) => void`.
- Estado local `deciding: boolean`.
- Cuando `matches.length >= 2`, mostrar arriba un botón
  **"🎲 ¿Cuál vemos?"** → `setDeciding(true)`.
- Renderizar `<MatchDecider matches={matches} onPick={onChoose} onClose={() => setDeciding(false)} />`
  cuando `deciding`.

### 3.2 `Swipe.tsx`
- Pasar `onChoose` al `MatchesList`:
```tsx
<MatchesList
  onClose={() => setShowMatches(false)}
  onChoose={(m) => { setShowMatches(false); setChosen(m); }}
/>
```
- `setChosen(m)` ya dispara la pantalla "¡Esta noche ven!" (early-return
  existente). No se crea ninguna pantalla de resultado nueva.

## 4. Testing
**Frontend:** sin runner → `tsc -b` + build + prueba manual:
- Con ≥2 matches aparece "¿Cuál vemos?".
- Ruleta gira y cae en uno; "Girar de nuevo" repite; "Ver esta" abre la pantalla final.
- Ronda: tocar de a pares elimina hasta que queda 1; "Ver esta" abre la final.
- Con <2 matches el botón no aparece.

La lógica (rey de la colina, índice de la ruleta) es trivial y vive en el
componente; se valida con build + manual (consistente con el resto del frontend,
que no tiene runner de tests).

## 5. Fuera de alcance
- Sincronización entre los dos teléfonos / votación compartida.
- Persistir la decisión o un historial.
- Animación de ruleta con física realista (alcanza con cicle + desaceleración).

## 6. Resumen de archivos tocados
- `frontend/src/components/MatchDecider.tsx` (nuevo) — modos ruleta + ronda.
- `frontend/src/components/MatchesList.tsx` — prop `onChoose` + botón "¿Cuál vemos?" + `MatchDecider`.
- `frontend/src/screens/Swipe.tsx` — pasar `onChoose` al `MatchesList`.
