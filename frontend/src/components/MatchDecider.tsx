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
