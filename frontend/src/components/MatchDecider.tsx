import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Disc3, Swords, ArrowLeft, RotateCcw } from 'lucide-react';
import type { Movie } from '../api';

type Mode = 'menu' | 'ruleta' | 'ronda';

function poster(movie: Movie | null): CSSProperties {
  return {
    backgroundImage: movie?.poster_url ? `url(${movie.poster_url})` : 'none',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundColor: '#1F1F23',
  };
}

const shellHeader = 'flex justify-between items-center px-[18px] pt-2.5 pb-2 shrink-0 border-b border-whisper';
const backBtn = 'text-reel-dim text-[16px] py-1 flex items-center gap-1';
const title = 'font-display text-[19px] text-screen font-bold';
const verEsta = 'bg-ember text-theater rounded-[14px] py-[15px] text-[18px] font-semibold w-full';
const secondaryBtn = 'bg-charcoal text-reel border border-whisper rounded-[14px] py-[13px] text-[17px] w-full';

export function MatchDecider({
  matches, onPick, onClose,
}: { matches: Movie[]; onPick: (m: Movie) => void; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('menu');

  return (
    <div className="fixed inset-0 z-[95] bg-theater">
      <div className="max-w-[430px] mx-auto h-full flex flex-col animate-slideUp">
        <div className="h-[60px] shrink-0" />
        {mode === 'menu' ? (
          <Menu count={matches.length} onClose={onClose} onRuleta={() => setMode('ruleta')} onRonda={() => setMode('ronda')} />
        ) : mode === 'ruleta' ? (
          <Ruleta matches={matches} onPick={onPick} onBack={() => setMode('menu')} />
        ) : (
          <Ronda matches={matches} onPick={onPick} onBack={() => setMode('menu')} />
        )}
      </div>
    </div>
  );
}

function Menu({ count, onClose, onRuleta, onRonda }: { count: number; onClose: () => void; onRuleta: () => void; onRonda: () => void }) {
  return (
    <>
      <div className={shellHeader}>
        <button onClick={onClose} className={backBtn}><ArrowLeft size={18} />Matches</button>
        <h2 className={title}>¿Cuál vemos?</h2>
        <div className="w-[60px]" />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-5 pt-6 pb-12 gap-3.5">
        <p className="text-[16px] text-reel-dim mb-2.5 text-center">Elige cómo decidir entre los {count} matches</p>
        <button onClick={onRuleta} className="w-full bg-charcoal border border-whisper rounded-[22px] px-5 py-6 flex flex-col items-center gap-3">
          <span className="w-14 h-14 rounded-full bg-ink border border-whisper flex items-center justify-center shrink-0">
            <Disc3 size={34} color="#D64A3F" />
          </span>
          <span className="font-display text-[19px] text-screen font-bold">Ruleta</span>
          <span className="text-[15px] text-reel-dim text-center">El azar elige — todos compiten</span>
        </button>
        <button onClick={onRonda} className="w-full bg-charcoal border border-whisper rounded-[22px] px-5 py-6 flex flex-col items-center gap-3">
          <span className="w-14 h-14 rounded-full bg-ink border border-whisper flex items-center justify-center shrink-0">
            <Swords size={32} color="#D64A3F" />
          </span>
          <span className="font-display text-[19px] text-screen font-bold">Ronda</span>
          <span className="text-[15px] text-reel-dim text-center">Enfrentamiento directo</span>
        </button>
      </div>
    </>
  );
}

function Ruleta({ matches, onPick, onBack }: { matches: Movie[]; onPick: (m: Movie) => void; onBack: () => void }) {
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

  const cols = matches.length <= 4 ? 2 : matches.length <= 9 ? 3 : 4;

  return (
    <>
      <div className={shellHeader}>
        <button onClick={onBack} className={backBtn}><ArrowLeft size={18} />Volver</button>
        <h2 className={title}>Ruleta</h2>
        <div className="w-[60px]" />
      </div>
      {result ? (
        <div className="flex-1 flex flex-col items-center justify-center px-7 pt-5 pb-10 gap-3 animate-fadeUp text-center">
          <p className="text-[14px] text-ember tracking-[0.18em] uppercase font-semibold mb-1">¡La ruleta eligió!</p>
          <div className="w-[148px] rounded-[14px] overflow-hidden shrink-0 animate-popIn shadow-[0_24px_48px_-12px_rgba(11,11,13,0.7)]">
            <div className="w-full aspect-[2/3]" style={poster(result)} />
          </div>
          <h3 className="font-display text-[21px] text-screen font-bold leading-[1.2] [text-wrap:pretty]">{result.title}</h3>
          {result.year && <p className="text-[16px] text-reel-dim font-mono">({result.year})</p>}
          <div className="flex flex-col gap-[9px] w-full mt-2">
            <button onClick={() => onPick(result)} className={verEsta}>Ver esta noche</button>
            <button onClick={spin} className={secondaryBtn}>
              <span className="flex items-center justify-center gap-1.5"><RotateCcw size={18} />Girar de nuevo</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center px-4 py-4 gap-3 min-h-0">
          <p className="text-[16px] text-reel-dim text-center shrink-0 [animation:dotPulse_1s_ease-in-out_infinite]">Girando…</p>
          <div
            className="grid gap-2 w-full flex-1 min-h-0 p-1 content-center"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridAutoRows: 'minmax(0, 1fr)',
            }}
          >
            {matches.map((m, idx) => {
              const hi = idx === highlight;
              return (
                <div
                  key={m.id}
                  className="rounded-[12px] overflow-hidden transition-all duration-100 min-h-0"
                  style={{
                    border: `2.5px solid ${hi ? '#D64A3F' : 'rgba(244,244,245,0.08)'}`,
                    boxShadow: 'none',
                    transform: hi ? 'scale(1.04)' : 'scale(1)',
                  }}
                >
                  <div className="w-full h-full" style={poster(m)} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function Ronda({ matches, onPick, onBack }: { matches: Movie[]; onPick: (m: Movie) => void; onBack: () => void }) {
  const [pool] = useState<Movie[]>(() => [...matches].sort(() => Math.random() - 0.5));
  const [champion, setChampion] = useState<Movie>(() => pool[0]);
  const [pos, setPos] = useState(1);
  const [picking, setPicking] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const done = pos >= pool.length;

  function pick(w: Movie) {
    if (picking) return;
    setPicking(true);
    timer.current = window.setTimeout(() => {
      setChampion(w);
      setPos((p) => p + 1);
      setPicking(false);
    }, 400);
  }
  function restart() { setChampion(pool[0]); setPos(1); setPicking(false); }

  return (
    <>
      <div className={shellHeader}>
        <button onClick={onBack} className={backBtn}><ArrowLeft size={18} />Volver</button>
        <h2 className={title}>Ronda</h2>
        <div className="w-[60px]" />
      </div>
      {done ? (
        <div className="flex-1 flex flex-col items-center justify-center px-7 pt-5 pb-10 gap-3 animate-fadeUp text-center">
          <p className="text-[14px] text-ember tracking-[0.18em] uppercase font-semibold mb-1">Ganadora</p>
          <div className="w-[148px] rounded-[14px] overflow-hidden shrink-0 animate-popIn shadow-[0_24px_48px_-12px_rgba(11,11,13,0.7)]">
            <div className="w-full aspect-[2/3]" style={poster(champion)} />
          </div>
          <h3 className="font-display text-[21px] text-screen font-bold leading-[1.2] [text-wrap:pretty]">{champion.title}</h3>
          {champion.year && <p className="text-[16px] text-reel-dim font-mono">({champion.year})</p>}
          <div className="flex flex-col gap-[9px] w-full mt-2">
            <button onClick={() => onPick(champion)} className={verEsta}>Ver esta noche</button>
            <button onClick={restart} className={secondaryBtn}>
              <span className="flex items-center justify-center gap-1.5"><RotateCcw size={18} />Otra vez</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center px-3 pt-3 pb-5 gap-2.5 overflow-hidden">
          <p className="text-[15px] text-reel-dim text-center shrink-0">
            Comparación {pos} de {pool.length - 1} — tocá la que querés ver
          </p>
          <div className="flex gap-2 w-full flex-1 min-h-0 items-stretch">
            {[champion, pool[pos]].map((m, i) => (
              <RondaCard key={`${m.id}-${i}`} movie={m} picking={picking} onClick={() => pick(m)} vsAfter={i === 0} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function RondaCard({ movie, picking, onClick, vsAfter }: { movie: Movie; picking: boolean; onClick: () => void; vsAfter: boolean }) {
  return (
    <>
      <button
        onClick={onClick}
        className="flex-1 bg-charcoal border border-whisper rounded-[14px] overflow-hidden p-0 flex flex-col text-left transition-[opacity,transform] duration-300"
        style={{ cursor: picking ? 'default' : 'pointer', opacity: picking ? 0.45 : 1, transform: picking ? 'scale(.97)' : 'scale(1)' }}
      >
        <div className="w-full flex-1 min-h-0" style={poster(movie)} />
        <div className="px-2 py-[7px] bg-charcoal shrink-0">
          <p className="text-screen text-[14px] font-medium leading-[1.3] [text-wrap:pretty]">{movie.title}</p>
          {movie.year && <p className="text-reel-dim text-[13px] font-mono mt-0.5">({movie.year})</p>}
        </div>
      </button>
      {vsAfter && (
        <div className="flex flex-col items-center justify-center shrink-0 gap-1 w-5">
          <div className="w-px bg-whisper flex-1" />
          <span className="text-[13px] text-reel-dim font-semibold tracking-[0.06em] [writing-mode:vertical-rl]">VS</span>
          <div className="w-px bg-whisper flex-1" />
        </div>
      )}
    </>
  );
}
