import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { SlidersHorizontal, RotateCcw, Heart, X, Undo2 } from 'lucide-react';
import { api, type Movie, type SessionFilters, type DeckResponse } from '../api';
import type { UserName, PresenceStatus } from '../types';
import { AVATAR, RING } from '../assets/avatars';
import { useSessionListener } from '../hooks';
import { applyFilters } from '../filters';
import { PresenceBadge } from '../components/PresenceBadge';
import { MovieCard } from '../components/MovieCard';
import { MatchOverlay } from '../components/MatchOverlay';
import { FilterBar } from '../components/FilterBar';

const MatchesList = lazy(() =>
  import('../components/MatchesList').then((m) => ({ default: m.MatchesList })),
);

function runtimeLabel(min: number | null): string {
  if (!min) return '';
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export function Swipe({ user, onWatchlists }: { user: UserName; onWatchlists: () => void }) {
  const [deck, setDeck] = useState<Movie[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [showMatches, setShowMatches] = useState(false);
  const [showFiltros, setShowFiltros] = useState(false);
  const [chosen, setChosen] = useState<Movie | null>(null);
  const [deckLoaded, setDeckLoaded] = useState(false);
  const [deckError, setDeckError] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [filters, setFilters] = useState<SessionFilters | null>(null);
  const [genres, setGenres] = useState<string[]>([]);

  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetOk, setResetOk] = useState(false);
  const [resetting, setResetting] = useState(false);

  const [lastSwiped, setLastSwiped] = useState<Movie | null>(null);
  const postTimer = useRef<number | undefined>(undefined);
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  const opacity = useTransform(x, [-200, 0, 200], [0.5, 1, 0.5]);
  const likeOpacity = useTransform(x, [0, 60], [0, 1]);
  const passOpacity = useTransform(x, [-60, 0], [1, 0]);

  const loadDeck = useCallback(async (): Promise<boolean> => {
    setDeckError(false);
    try {
      const r: DeckResponse = await api.get(`/deck?user=${user}`);
      setDeck(r.deck); setGenres(r.genres); setFilters(r.filters); setDeckLoaded(true);
      return true;
    } catch {
      setDeckError(true);
      return false;
    }
  }, [user]);

  useEffect(() => { loadDeck(); }, [loadDeck]);

  useEffect(() => {
    api.get('/matches').then((r) => { setMatchCount(r.matches.length); setSessionId(r.sessionId); });
  }, []);

  async function softReset(id: string, by?: string | null) {
    setExpanded(false);
    setShowMatches(false);
    setShowFiltros(false);
    setChosen(null);
    setMatchCount(0);
    setSessionId(id);
    setLastSwiped(null);
    x.set(0);
    const quien = by ? `${by} empezó una noche nueva` : 'Reiniciando mazo…';
    setResetOk(false);
    setResetMsg(quien);
    setResetting(true);
    setDeckLoaded(false);
    const ok = await loadDeck();
    setResetting(false);
    if (!ok) return;
    setResetOk(true);
    setResetMsg('Mazo nuevo listo');
    setTimeout(() => setResetMsg(null), 2000);
  }

  function applyLocalFilter(next: SessionFilters) {
    setFilters(next);
    window.clearTimeout(postTimer.current);
    postTimer.current = window.setTimeout(async () => {
      await api.post('/session/filters', { user, filters: next });
    }, 400);
  }

  const onFiltersChanged = useCallback((f: SessionFilters | null, by: string) => {
    setFilters(f);
    setAviso(`${by} cambió el filtro`);
    setTimeout(() => setAviso(null), 4000);
  }, []);

  useSessionListener(user, sessionId, (newSessionId, startedBy) => {
    softReset(newSessionId, startedBy);
  }, onFiltersChanged);

  const bumpCount = useCallback(() => setMatchCount((c) => c + 1), []);

  async function nuevaSesion() {
    const s = await api.post('/session', { user });
    softReset(s.id);
  }

  async function confirmarNuevaSesion() {
    if (window.confirm('¿Empezar una sesión nueva? Se reinicia el mazo y los matches de esta noche para las dos.')) {
      await nuevaSesion();
    }
  }

  const visibleDeck = applyFilters(deck, filters);
  const top = visibleDeck[0];
  const myStatus: PresenceStatus = !deckLoaded ? 'en-linea' : visibleDeck.length > 0 ? 'swipeando' : 'termino';
  const activeFilter = !!filters && (filters.maxRuntime != null || filters.excludeGenres.length > 0);

  if (chosen) {
    return (
      <div className="min-h-screen max-w-[430px] mx-auto flex flex-col items-center justify-center px-6 pb-8 text-center overflow-y-auto animate-fadeUp">
        <p className="text-[13px] text-ember tracking-[0.2em] uppercase font-semibold mb-4">Esta noche ven</p>
        <div className="w-40 rounded-[16px] overflow-hidden mb-4 shrink-0 animate-popIn shadow-[0_24px_48px_-12px_rgba(11,11,13,0.7)]">
          <div
            className="w-full aspect-[2/3] bg-cover bg-center"
            style={{ backgroundImage: chosen.poster_url ? `url(${chosen.poster_url})` : 'none', backgroundColor: '#1F1F23' }}
          />
        </div>
        <h2 className="font-display text-[23px] text-screen font-bold leading-[1.2] mb-[5px] [text-wrap:pretty]">{chosen.title}</h2>
        <p className="text-[16px] text-reel-dim font-mono mb-[3px]">
          {chosen.year}{chosen.runtime ? ` · ${runtimeLabel(chosen.runtime)}` : ''}
        </p>
        {chosen.director && <p className="text-[15px] text-reel-dim italic mb-[22px]">Dir. {chosen.director}</p>}
        <div className="flex items-center justify-center gap-3.5 mb-6">
          <img src={AVATAR.Jo} className="w-[38px] h-[38px] rounded-full object-cover border-[1.5px]" style={{ borderColor: RING.Jo }} />
          <span className="text-reel-dim text-[18px]">+</span>
          <img src={AVATAR.Vale} className="w-[38px] h-[38px] rounded-full object-cover border-[1.5px]" style={{ borderColor: RING.Vale }} />
        </div>
        <div className="flex gap-2.5 w-full">
          <button onClick={() => setChosen(null)} className="flex-1 bg-charcoal text-reel border border-whisper rounded-[14px] py-[13px] text-[17px]">Elegir otra</button>
          <button onClick={nuevaSesion} className="flex-1 bg-ember text-theater rounded-[14px] py-[13px] text-[17px] font-semibold">Nueva noche</button>
        </div>
      </div>
    );
  }

  async function swipe(liked: boolean) {
    if (!top) return;
    const movie = top;
    setDeck((d) => d.filter((m) => m.id !== movie.id));

    setLastSwiped(liked ? null : movie);
    setExpanded(false);
    x.set(0);

    await api.post('/swipe', { user, movieId: movie.id, liked });
  }

  async function undo() {
    if (!lastSwiped) return;
    const movie = lastSwiped;
    setLastSwiped(null);
    setDeck((d) => [movie, ...d]);
    x.set(0);
    await api.post('/swipe/undo', { user, movieId: movie.id });
  }

  return (
    <div className="min-h-screen max-w-[430px] mx-auto flex flex-col relative overflow-hidden animate-fadeUp">
      {aviso && (
        <div className="fixed top-3 inset-x-0 z-40 mx-auto w-fit rounded-[20px] bg-charcoal border border-whisper px-3.5 py-1.5 text-[15px] text-reel animate-slideDown">
          {aviso}
        </div>
      )}

      <div className="flex justify-between items-center px-3.5 pt-1.5 pb-1 shrink-0">
        <button onClick={onWatchlists} className="flex items-center gap-1.5 py-1">
          <img src={AVATAR[user]} className="w-[22px] h-[22px] rounded-full object-cover border-[1.5px]" style={{ borderColor: RING[user] }} />
          <span className="text-[16px] text-screen font-medium">{user}</span>
          <span className="text-[14px] text-reel-dim ml-0.5">watchlists</span>
        </button>
        <div className="flex gap-[7px] items-center">
          <button
            onClick={() => setShowFiltros((f) => !f)}
            aria-label="Filtros"
            className="rounded-[20px] px-2.5 py-[6px] text-[15px] flex items-center gap-1 bg-charcoal"
            style={{
              color: activeFilter ? '#D64A3F' : '#5C5C63',
              border: `1px solid ${activeFilter ? '#D64A3F' : 'rgba(244,244,245,0.08)'}`,
            }}
          >
            <SlidersHorizontal size={17} />
            {activeFilter && <span className="w-[5px] h-[5px] bg-ember rounded-full inline-block shrink-0" />}
          </button>
          <button onClick={confirmarNuevaSesion} aria-label="Nueva sesión" className="bg-charcoal text-reel-dim border border-whisper rounded-[20px] px-2 py-[6px] flex items-center">
            <RotateCcw size={17} />
          </button>
          <button onClick={() => setShowMatches(true)} className="bg-charcoal border border-whisper rounded-[20px] px-2.5 py-[5px] text-[15px] text-ember flex items-center gap-1 font-medium">
            <Heart size={15} color="#D64A3F" fill="#D64A3F" /><span className="font-mono">{matchCount}</span>
          </button>
        </div>
      </div>

      <div className="flex justify-between items-center px-4 pt-0.5 pb-1.5 shrink-0">
        <PresenceBadge me={user} myStatus={myStatus} />
        {deckLoaded && !resetting && (
          <span className="text-[14px] text-reel-dim"><span className="font-mono">{visibleDeck.length}</span> por ver</span>
        )}
      </div>

      {resetMsg && (
        <div className="flex justify-center px-4 pb-1 shrink-0 animate-slideDown">
          <div
            className="rounded-[20px] px-3.5 py-[5px]"
            style={{
              background: '#161619',
              border: '1px solid rgba(244,244,245,0.08)',
            }}
          >
            <span className="text-[15px]" style={{ color: resetOk ? '#D64A3F' : '#8A8A93' }}>{resetMsg}</span>
          </div>
        </div>
      )}

      <div className="flex-1 px-3 pt-0.5 relative overflow-visible min-h-0">
        {resetting ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-4 h-4 border-2 border-ember border-t-transparent rounded-full animate-spin" />
            <div className="text-reel-dim text-[16px]">Reiniciando mazo…</div>
          </div>
        ) : !deckLoaded && !deckError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-4 h-4 border-2 border-ember border-t-transparent rounded-full animate-spin" />
            <div className="text-reel-dim text-[16px]">Cargando películas…</div>
          </div>
        ) : deckError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-8">
            <h3 className="font-display text-[21px] text-screen font-bold">No se pudo cargar</h3>
            <p className="text-reel-dim text-[16px] leading-[1.65]">Revisá tu conexión e intentá de nuevo.</p>
            <button onClick={loadDeck} className="bg-charcoal border border-whisper text-ember rounded-[12px] px-[22px] py-[11px] text-[17px] mt-1.5 flex items-center gap-1.5">
              Reintentar <RotateCcw size={18} />
            </button>
          </div>
        ) : top ? (
          <>
            <div className="absolute inset-x-5 top-2.5 bottom-0 bg-ink rounded-[20px] z-0" />
            <div className="absolute inset-x-4 top-1.5 bottom-0 bg-charcoal rounded-[20px] z-0" />

            <motion.div
              key={top.id}
              style={{ x, rotate, opacity }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              onDragEnd={(_, info) => {
                if (info.offset.x > 120) swipe(true);
                else if (info.offset.x < -120) swipe(false);
              }}
              className="absolute inset-0 z-[1]"
            >
              <MovieCard movie={top} expanded={expanded} onToggle={() => setExpanded((e) => !e)} />
              <motion.div style={{ opacity: likeOpacity }} className="absolute top-[18px] left-3.5 border-[2.5px] border-ember rounded-lg px-3 py-1 pointer-events-none">
                <span className="text-ember font-bold text-[16px] tracking-[0.12em]">LIKE</span>
              </motion.div>
              <motion.div style={{ opacity: passOpacity }} className="absolute top-[18px] right-3.5 border-[2.5px] border-reel rounded-lg px-3 py-1 pointer-events-none">
                <span className="text-reel font-bold text-[16px] tracking-[0.12em]">PASS</span>
              </motion.div>
            </motion.div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-8">
            <h3 className="font-display text-[21px] text-screen font-bold">Terminaste tu mazo</h3>
            <p className="text-reel-dim text-[16px] leading-[1.65]">
              La otra sigue eligiendo…<br />mirá los matches mientras esperás.
            </p>
            {matchCount > 0 && (
              <button onClick={() => setShowMatches(true)} className="bg-charcoal border border-whisper text-ember rounded-[12px] px-[22px] py-[11px] text-[17px] mt-1.5 flex items-center gap-1.5">
                Ver matches <Heart size={18} fill="currentColor" />
              </button>
            )}
            <button onClick={onWatchlists} className="text-reel-dim text-[15px] mt-1 underline">Actualizar watchlists</button>
          </div>
        )}
      </div>

      {lastSwiped && !resetting && (
        <div className="flex justify-center pt-1.5 shrink-0 animate-fadeUp">
          <button onClick={undo} className="bg-charcoal border border-whisper text-reel rounded-[20px] px-4 py-[6px] text-[15px] flex items-center gap-1.5">
            <Undo2 size={17} /><span>Deshacer</span>
          </button>
        </div>
      )}

      {top && !resetting && (
        <div className="flex justify-center items-center gap-[26px] px-5 pt-2.5 pb-3 shrink-0">
          <button onClick={() => swipe(false)} aria-label="Paso" className="w-[58px] h-[58px] rounded-full bg-charcoal border border-whisper text-reel-dim flex items-center justify-center shrink-0"><X size={28} strokeWidth={2.5} /></button>
          <button onClick={() => swipe(true)} aria-label="Me gusta" className="w-[72px] h-[72px] rounded-full bg-ember text-theater flex items-center justify-center shrink-0"><Heart size={34} fill="currentColor" /></button>
          <div className="w-[58px] shrink-0" />
        </div>
      )}

      <FilterBar
        genres={genres}
        filters={filters}
        open={showFiltros}
        onChange={applyLocalFilter}
        onClose={() => setShowFiltros(false)}
      />

      <MatchOverlay sessionId={sessionId} onCount={bumpCount} onChoose={setChosen} />
      {showMatches && (
        <Suspense fallback={null}>
          <MatchesList
            onClose={() => setShowMatches(false)}
            onChoose={(m) => { setShowMatches(false); setChosen(m); }}
          />
        </Suspense>
      )}
    </div>
  );
}
