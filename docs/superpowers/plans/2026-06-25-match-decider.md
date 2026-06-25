# Decidir qué match ver (ruleta + ronda) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Con varios matches, elegir cuál ver: una ruleta al azar o una ronda "esto o lo otro", en un solo teléfono.

**Architecture:** Componente `MatchDecider` (frontend puro) con dos modos. Se abre desde `MatchesList` cuando hay ≥2 matches; el resultado alimenta la pantalla "¡Esta noche ven!" ya existente vía `onChoose`. Sin backend, DB ni Realtime.

**Tech Stack:** React 19 + Vite + Tailwind (frontend, sin runner de tests). Reusa `Movie` de `../api`.

## Global Constraints

- **Todo corre en Docker. Nunca `npm`/`node` en el host.** Desde la raíz `/Users/jo/Documents/TheCinematicUs`:
  - frontend typecheck: `docker compose run --rm --workdir /app/frontend frontend npx tsc -b`
  - frontend build: `docker compose run --rm --workdir /app/frontend frontend npm run build`
- **Frontend sin runner de tests** → cada tarea se valida con `tsc -b` + build + prueba manual.
- **Commits normales por tarea, mensaje en español, estilo repo. NO trailer `Co-Authored-By: Claude`.**
- **Un solo teléfono** (sin sync). **Ronda = rey de la colina** (campeona vs siguiente, N-1 comparaciones). Resultado → `onPick(movie)`.

---

### Task 1: Componente `MatchDecider` (ruleta + ronda)

**Files:**
- Create: `frontend/src/components/MatchDecider.tsx`

**Interfaces:**
- Consumes: `Movie` de `../api`.
- Produces: `MatchDecider({ matches: Movie[]; onPick: (m: Movie) => void; onClose: () => void })`.

- [ ] **Step 1: Crear `MatchDecider.tsx`**

Create `frontend/src/components/MatchDecider.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { Movie } from '../api';

type Mode = 'menu' | 'ruleta' | 'ronda';

export function MatchDecider({
  matches, onPick, onClose,
}: { matches: Movie[]; onPick: (m: Movie) => void; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('menu');

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950 flex flex-col p-4 overflow-y-auto">
      <div className="flex justify-between items-center mb-4 max-w-md mx-auto w-full">
        <button
          onClick={() => (mode === 'menu' ? onClose() : setMode('menu'))}
          className="text-neutral-400"
        >
          {mode === 'menu' ? 'Cerrar' : '← Volver'}
        </button>
        <h2 className="text-lg">¿Cuál vemos?</h2>
        <span className="w-12" />
      </div>

      <div className="flex-1 max-w-md mx-auto w-full">
        {mode === 'menu' && (
          <div className="flex flex-col gap-4 mt-8">
            <button onClick={() => setMode('ruleta')} className="rounded-xl bg-rose-600 py-5 text-lg font-medium">🎰 Ruleta</button>
            <button onClick={() => setMode('ronda')} className="rounded-xl bg-neutral-800 py-5 text-lg font-medium">⚔️ Ronda</button>
          </div>
        )}
        {mode === 'ruleta' && <Ruleta matches={matches} onPick={onPick} />}
        {mode === 'ronda' && <Ronda matches={matches} onPick={onPick} />}
      </div>
    </div>
  );
}

// Ruleta: cicla un resaltado por los posters, desacelerando, hasta caer en uno
// al azar. total % length === winnerIdx → aterriza en el ganador.
function Ruleta({ matches, onPick }: { matches: Movie[]; onPick: (m: Movie) => void }) {
  const [highlight, setHighlight] = useState(0);
  const [result, setResult] = useState<Movie | null>(null);
  const timer = useRef<number | undefined>(undefined);

  function spin() {
    setResult(null);
    const winnerIdx = Math.floor(Math.random() * matches.length);
    const total = matches.length * 3 + winnerIdx;
    let i = 0;
    const step = () => {
      setHighlight(i % matches.length);
      if (i >= total) { setResult(matches[winnerIdx]); return; }
      i++;
      timer.current = window.setTimeout(step, 60 + (i / total) * 240);
    };
    step();
  }

  useEffect(() => { spin(); return () => window.clearTimeout(timer.current); }, []);

  return (
    <div className="flex flex-col items-center gap-4 mt-2">
      <div className="grid grid-cols-3 gap-2 w-full">
        {matches.map((m, idx) => {
          const isHi = idx === highlight && !result;
          const isWin = result?.id === m.id;
          return (
            <div
              key={m.id}
              className={`rounded-lg overflow-hidden transition-transform ${isWin ? 'ring-4 ring-emerald-500 scale-105' : isHi ? 'ring-4 ring-rose-500 scale-105' : 'opacity-60'}`}
            >
              {m.poster_url
                ? <img src={m.poster_url} className="w-full" />
                : <div className="aspect-[2/3] flex items-center justify-center text-xs p-1 text-center bg-neutral-800">{m.title}</div>}
            </div>
          );
        })}
      </div>
      {result ? (
        <div className="flex flex-col items-center gap-3 mt-2">
          <div className="text-xl font-semibold text-center">🎬 {result.title}</div>
          <div className="flex gap-3">
            <button onClick={spin} className="rounded-lg bg-neutral-800 px-5 py-3">Girar de nuevo</button>
            <button onClick={() => onPick(result)} className="rounded-lg bg-rose-600 px-5 py-3 font-medium">Ver esta</button>
          </div>
        </div>
      ) : (
        <div className="text-neutral-500 text-sm">girando…</div>
      )}
    </div>
  );
}

// Ronda rey de la colina: campeona vs siguiente; la elegida pasa a campeona;
// hasta que no quedan retadoras. N-1 comparaciones.
function Ronda({ matches, onPick }: { matches: Movie[]; onPick: (m: Movie) => void }) {
  const [pool] = useState<Movie[]>(() => [...matches].sort(() => Math.random() - 0.5));
  const [champion, setChampion] = useState<Movie>(() => pool[0]);
  const [pos, setPos] = useState(1);

  const done = pos >= pool.length;

  function pick(w: Movie) { setChampion(w); setPos((p) => p + 1); }
  function restart() { setChampion(pool[0]); setPos(1); }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 mt-4">
        <div className="text-xl font-semibold text-center">🏆 {champion.title}</div>
        {champion.poster_url && <img src={champion.poster_url} className="max-h-[40vh] rounded-xl" />}
        <div className="flex gap-3">
          <button onClick={restart} className="rounded-lg bg-neutral-800 px-5 py-3">Otra vez</button>
          <button onClick={() => onPick(champion)} className="rounded-lg bg-rose-600 px-5 py-3 font-medium">Ver esta</button>
        </div>
      </div>
    );
  }

  const challenger = pool[pos];
  return (
    <div className="flex flex-col items-center gap-3 mt-2">
      <div className="text-sm text-neutral-500">Comparación {pos} de {pool.length - 1}</div>
      <div className="grid grid-cols-2 gap-3 w-full">
        {[champion, challenger].map((m, i) => (
          <button
            key={`${m.id}-${i}`}
            onClick={() => pick(m)}
            className="rounded-xl overflow-hidden bg-neutral-900 active:scale-95 transition-transform text-left"
          >
            {m.poster_url
              ? <img src={m.poster_url} className="w-full" />
              : <div className="aspect-[2/3] flex items-center justify-center text-xs p-1 text-center">{m.title}</div>}
            <p className="p-2 text-sm">{m.title}</p>
          </button>
        ))}
      </div>
      <div className="text-neutral-500 text-xs">Tocá la que prefieras</div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `docker compose run --rm --workdir /app/frontend frontend npx tsc -b`
Run: `docker compose run --rm --workdir /app/frontend frontend npm run build`
Expected: `tsc` sin errores + build OK. (El componente todavía no se usa en ningún lado; compila igual como export.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/MatchDecider.tsx
git commit -m "feat(frontend): MatchDecider — ruleta y ronda para elegir qué match ver"
```

---

### Task 2: Cablear en `MatchesList` + `Swipe`

**Files:**
- Modify: `frontend/src/components/MatchesList.tsx`
- Modify: `frontend/src/screens/Swipe.tsx`

**Interfaces:**
- Consumes: `MatchDecider` de `./MatchDecider` (Task 1).
- Produces: `MatchesList({ onClose: () => void; onChoose: (m: Movie) => void })`.

- [ ] **Step 1: Reescribir `MatchesList.tsx`**

Reemplazar `frontend/src/components/MatchesList.tsx` por:

```tsx
// frontend/src/components/MatchesList.tsx
import { useEffect, useState } from 'react';
import { api, type Movie } from '../api';
import { MatchDecider } from './MatchDecider';

export function MatchesList({ onClose, onChoose }: { onClose: () => void; onChoose: (m: Movie) => void }) {
  const [matches, setMatches] = useState<Movie[]>([]);
  const [deciding, setDeciding] = useState(false);
  useEffect(() => { api.get('/matches').then((r) => setMatches(r.matches)); }, []);

  return (
    <div className="fixed inset-0 z-40 bg-neutral-950 p-4 overflow-y-auto">
      <div className="flex justify-between items-center mb-4 max-w-md mx-auto">
        <h2 className="text-xl">Matches de esta noche</h2>
        <button onClick={onClose} className="text-neutral-400">Cerrar</button>
      </div>

      {matches.length >= 2 && (
        <div className="max-w-md mx-auto mb-3">
          <button onClick={() => setDeciding(true)} className="w-full rounded-lg bg-rose-600 py-3 font-medium">
            🎲 ¿Cuál vemos?
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 max-w-md mx-auto">
        {matches.length === 0 && <p className="text-neutral-500 col-span-2">Todavía no hay matches.</p>}
        {matches.map((m) => (
          <div key={m.id} className="rounded-xl overflow-hidden bg-neutral-900">
            {m.poster_url && <img src={m.poster_url} className="w-full" />}
            <p className="p-2 text-sm">{m.title}</p>
          </div>
        ))}
      </div>

      {deciding && (
        <MatchDecider matches={matches} onPick={onChoose} onClose={() => setDeciding(false)} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Pasar `onChoose` en `Swipe.tsx`**

En `frontend/src/screens/Swipe.tsx`, en el render del `MatchesList` (dentro del `{showMatches && (...)}`), reemplazar:

```tsx
          <MatchesList onClose={() => setShowMatches(false)} />
```

por:

```tsx
          <MatchesList
            onClose={() => setShowMatches(false)}
            onChoose={(m) => { setShowMatches(false); setChosen(m); }}
          />
```

(`setChosen` ya existe y dispara la pantalla "¡Esta noche ven!".)

- [ ] **Step 3: Typecheck + build**

Run: `docker compose run --rm --workdir /app/frontend frontend npx tsc -b`
Run: `docker compose run --rm --workdir /app/frontend frontend npm run build`
Expected: `tsc` sin errores + build OK.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/MatchesList.tsx frontend/src/screens/Swipe.tsx
git commit -m "feat(frontend): botón ¿Cuál vemos? en matches + resultado a la pantalla final"
```

---

## Verificación manual (app levantada, con ≥2 matches en la sesión)
1. Abrir ❤️ matches → aparece "🎲 ¿Cuál vemos?".
2. Ruleta: gira, desacelera y cae en una; "Girar de nuevo" repite; "Ver esta" → pantalla "¡Esta noche ven!".
3. Ronda: muestra de a pares; tocar elimina a la otra; al final una ganadora; "Ver esta" → pantalla final.
4. ← Volver vuelve al menú; Cerrar cierra el decididor.
5. Con <2 matches el botón "¿Cuál vemos?" no aparece.

## Fuera de alcance (anotado)
- Sync entre los dos teléfonos, persistir la decisión, animación de ruleta con física realista.
