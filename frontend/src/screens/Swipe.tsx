// frontend/src/screens/Swipe.tsx
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { SlidersHorizontal, RotateCcw, Heart, X, Undo2 } from 'lucide-react';
import { api, type Movie, type SessionFilters, type DeckResponse } from '../api';
import type { UserName, PresenceStatus } from '../types';
import { AVATAR, RING } from '../assets/avatars';
import { useSessionListener } from '../hooks';
import { PresenceBadge } from '../components/PresenceBadge';
import { MovieCard } from '../components/MovieCard';
import { MatchOverlay } from '../components/MatchOverlay';
import { FilterBar } from '../components/FilterBar';
// Se carga solo al abrir el modal de matches (no se necesita en el primer paint).
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
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [filters, setFilters] = useState<SessionFilters | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  // Banner de transición de noche nueva: 'reiniciando' mientras recarga el mazo,
  // 'listo' cuando terminó. Atado al fin de loadDeck, no a un timeout arbitrario.
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  // Última peli swipeada, para deshacer (single-level).
  const [lastSwiped, setLastSwiped] = useState<Movie | null>(null);
  const postTimer = useRef<number | undefined>(undefined);
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  const opacity = useTransform(x, [-200, 0, 200], [0.5, 1, 0.5]);
  const likeOpacity = useTransform(x, [0, 60], [0, 1]);
  const passOpacity = useTransform(x, [-60, 0], [1, 0]);

  const loadDeck = useCallback(async () => {
    const r: DeckResponse = await api.get(`/deck?user=${user}`);
    setDeck(r.deck); setGenres(r.genres); setFilters(r.filters); setDeckLoaded(true);
  }, [user]);

  useEffect(() => { loadDeck(); }, [loadDeck]);
  // Contador real + sessionId actual (baseline de la suscripción y scoping de matches vistos).
  useEffect(() => {
    api.get('/matches').then((r) => { setMatchCount(r.matches.length); setSessionId(r.sessionId); });
  }, []);

  // Reacomoda la pantalla a la sesión `id` sin recargar la página. `by` = quién
  // inició la noche (null/undefined = la inicié yo). Muestra el banner de
  // transición y recién marca 'listo' cuando el mazo nuevo terminó de cargar.
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
    setResetMsg(quien);
    setResetting(true);
    setDeckLoaded(false);
    await loadDeck();
    setResetting(false);
    setResetMsg('✓ Mazo nuevo listo');
    setTimeout(() => setResetMsg(null), 2000);
  }

  function applyLocalFilter(next: SessionFilters) {
    setFilters(next); // feedback inmediato del control
    window.clearTimeout(postTimer.current);
    postTimer.current = window.setTimeout(async () => {
      await api.post('/session/filters', { user, filters: next });
      await loadDeck();
    }, 400);
  }

  const onFiltersChanged = useCallback((f: SessionFilters | null, by: string) => {
    setFilters(f);
    loadDeck();
    setAviso(`${by} cambió el filtro`);
    setTimeout(() => setAviso(null), 4000);
  }, [loadDeck]);

  // En vivo: si la otra inicia una noche nueva, reacomodar con el banner de transición.
  useSessionListener(user, sessionId, (newSessionId, startedBy) => {
    softReset(newSessionId, startedBy);
  }, onFiltersChanged);

  const bumpCount = useCallback(() => setMatchCount((c) => c + 1), []);

  // Empezar una noche nueva: crea la sesión (queda quién la inició) y reacomoda localmente.
  async function nuevaSesion() {
    const s = await api.post('/session', { user });
    softReset(s.id);
  }

  // Desde el header pedimos confirmación: reinicia la noche para las dos.
  async function confirmarNuevaSesion() {
    if (window.confirm('¿Empezar una sesión nueva? Se reinicia el mazo y los matches de esta noche para las dos.')) {
      await nuevaSesion();
    }
  }

  const top = deck[0];
  const myStatus: PresenceStatus = !deckLoaded ? 'en-linea' : deck.length > 0 ? 'swipeando' : 'termino';
  const activeFilter = !!filters && (filters.maxRuntime != null || filters.excludeGenres.length > 0);

  // Película elegida: pantalla final, en vez de caer en "terminaste tu mazo".
  if (chosen) {
    return (
      <div className="min-h-screen max-w-[430px] mx-auto flex flex-col items-center justify-center px-6 pb-8 text-center overflow-y-auto animate-fadeUp">
        <p className="text-[10px] text-[#7c3aed] tracking-[0.2em] uppercase font-semibold mb-4">Esta noche ven</p>
        <div className="w-40 rounded-[16px] overflow-hidden mb-4 shrink-0 [animation:glowPulse_3s_ease_infinite,popIn_.5s_ease_both]">
          <div
            className="w-full aspect-[2/3] bg-cover bg-center"
            style={{ backgroundImage: chosen.poster_url ? `url(${chosen.poster_url})` : 'none', backgroundColor: '#1a1a2e' }}
          />
        </div>
        <h2 className="font-display text-[23px] text-[#f8f8fa] font-bold leading-[1.2] mb-[5px] [text-wrap:pretty]">{chosen.title}</h2>
        <p className="text-[13px] text-[#3a3a50] mb-[3px]">
          {chosen.year}{chosen.runtime ? ` · ${runtimeLabel(chosen.runtime)}` : ''}
        </p>
        {chosen.director && <p className="text-[12px] text-[#3a3a50] italic mb-[22px]">Dir. {chosen.director}</p>}
        <div className="flex items-center justify-center gap-3.5 mb-6">
          <img src={AVATAR.Jo} className="w-[38px] h-[38px] rounded-full object-cover border-[1.5px]" style={{ borderColor: RING.Jo }} />
          <span className="text-[#3a3a50] text-[18px]">+</span>
          <img src={AVATAR.Vale} className="w-[38px] h-[38px] rounded-full object-cover border-[1.5px]" style={{ borderColor: RING.Vale }} />
        </div>
        <div className="flex gap-2.5 w-full">
          <button onClick={() => setChosen(null)} className="flex-1 bg-[#111118] text-[#6b6b82] border-[1.5px] border-[#26263a] rounded-[14px] py-[13px] text-[14px]">Elegir otra</button>
          <button onClick={nuevaSesion} className="flex-1 bg-[#7c3aed] text-white rounded-[14px] py-[13px] text-[14px] font-semibold">Nueva noche</button>
        </div>
      </div>
    );
  }

  async function swipe(liked: boolean) {
    if (!top) return;
    const movie = top;
    setDeck((d) => d.slice(1));
    // Solo se puede deshacer un descarte (pass), no un like: si la otra también
    // likeó hay match, y un match no se borra (como en apps de citas).
    setLastSwiped(liked ? null : movie);
    setExpanded(false);
    x.set(0);
    // No incrementamos acá: el contador lo maneja SOLO el Realtime (MatchOverlay.onCount).
    await api.post('/swipe', { user, movieId: movie.id, liked });
  }

  // Deshace el último DESCARTE (single-level): vuelve la card arriba del mazo y
  // borra el swipe en el backend. Solo aplica a passes (lastSwiped nunca se
  // setea en un like), así que nunca toca un match.
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
        <div className="fixed top-3 inset-x-0 z-40 mx-auto w-fit rounded-[20px] bg-[#141420] border border-[#26263a] px-3.5 py-1.5 text-[12px] text-[#5a5a72] animate-slideDown">
          {aviso}
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center px-3.5 pt-1.5 pb-1 shrink-0">
        <button onClick={onWatchlists} className="flex items-center gap-1.5 py-1">
          <img src={AVATAR[user]} className="w-[22px] h-[22px] rounded-full object-cover border-[1.5px]" style={{ borderColor: RING[user] }} />
          <span className="text-[13px] text-[#f8f8fa] font-medium">{user}</span>
          <span className="text-[11px] text-[#3a3a50] ml-0.5">watchlists</span>
        </button>
        <div className="flex gap-[7px] items-center">
          <button
            onClick={() => setShowFiltros((f) => !f)}
            aria-label="Filtros"
            className="rounded-[20px] px-2.5 py-[6px] text-[12px] flex items-center gap-1 bg-[#111118]"
            style={{
              color: activeFilter ? '#a78bfa' : '#4a4a62',
              border: `1px solid ${activeFilter ? 'rgba(124,58,237,.4)' : '#26263a'}`,
            }}
          >
            <SlidersHorizontal size={13} />
            {activeFilter && <span className="w-[5px] h-[5px] bg-[#a78bfa] rounded-full inline-block shrink-0" />}
          </button>
          <button onClick={confirmarNuevaSesion} aria-label="Nueva sesión" className="bg-[#111118] text-[#4a4a62] border border-[#26263a] rounded-[20px] px-2 py-[6px] flex items-center">
            <RotateCcw size={13} />
          </button>
          <button onClick={() => setShowMatches(true)} className="bg-[#111118] border border-[#26263a] rounded-[20px] px-2.5 py-[5px] text-[12px] text-[#a78bfa] flex items-center gap-1 font-medium">
            <Heart size={11} color="#ec4899" fill="#ec4899" />{matchCount}
          </button>
        </div>
      </div>

      {/* Presencia + count */}
      <div className="flex justify-between items-center px-4 pt-0.5 pb-1.5 shrink-0">
        <PresenceBadge me={user} myStatus={myStatus} />
        {deckLoaded && !resetting && (
          <span className="text-[11px] text-[#3a3a50]">{Math.max(0, deck.length)} por ver</span>
        )}
      </div>

      {/* Banner de sesión */}
      {resetMsg && (
        <div className="flex justify-center px-4 pb-1 shrink-0 animate-slideDown">
          <div
            className="rounded-[20px] px-3.5 py-[5px]"
            style={{
              background: resetMsg.includes('✓') ? '#0a1f10' : '#141420',
              border: `1px solid ${resetMsg.includes('✓') ? '#166534' : '#26263a'}`,
            }}
          >
            <span className="text-[12px]" style={{ color: resetMsg.includes('✓') ? '#4ade80' : '#5a5a72' }}>{resetMsg}</span>
          </div>
        </div>
      )}

      {/* Deck */}
      <div className="flex-1 px-3 pt-0.5 relative overflow-visible min-h-0">
        {resetting ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-4 h-4 border-2 border-[#7c3aed] border-t-transparent rounded-full animate-spin" />
            <div className="text-[#4a4a62] text-[13px]">Reiniciando mazo…</div>
          </div>
        ) : top ? (
          <>
            {/* Cartas apiladas de fondo */}
            <div className="absolute inset-x-5 top-2.5 bottom-0 bg-[#14141d] rounded-[20px] z-0" />
            <div className="absolute inset-x-4 top-1.5 bottom-0 bg-[#0f0f17] rounded-[20px] z-0" />

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
              <motion.div style={{ opacity: likeOpacity }} className="absolute top-[18px] left-3.5 border-[2.5px] border-[#7c3aed] rounded-lg px-3 py-1 pointer-events-none">
                <span className="text-[#a78bfa] font-bold text-[13px] tracking-[0.12em]">LIKE</span>
              </motion.div>
              <motion.div style={{ opacity: passOpacity }} className="absolute top-[18px] right-3.5 border-[2.5px] border-[#ef4444] rounded-lg px-3 py-1 pointer-events-none">
                <span className="text-[#f87171] font-bold text-[13px] tracking-[0.12em]">PASS</span>
              </motion.div>
            </motion.div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-8">
            <h3 className="font-display text-[21px] text-[#f8f8fa] font-bold">Terminaste tu mazo</h3>
            <p className="text-[#3a3a50] text-[13px] leading-[1.65]">
              La otra sigue eligiendo…<br />mirá los matches mientras esperás.
            </p>
            {matchCount > 0 && (
              <button onClick={() => setShowMatches(true)} className="bg-[#111118] border-[1.5px] border-[#26263a] text-[#a78bfa] rounded-[12px] px-[22px] py-[11px] text-[14px] mt-1.5 flex items-center gap-1.5">
                Ver matches <Heart size={14} fill="currentColor" />
              </button>
            )}
            <button onClick={onWatchlists} className="text-[#3a3a50] text-[12px] mt-1 underline">Actualizar watchlists</button>
          </div>
        )}
      </div>

      {/* Undo */}
      {lastSwiped && !resetting && (
        <div className="flex justify-center pt-1.5 shrink-0 animate-fadeUp">
          <button onClick={undo} className="bg-[#111118] border border-[#26263a] text-[#5a5a72] rounded-[20px] px-4 py-[6px] text-[12px] flex items-center gap-1.5">
            <Undo2 size={13} /><span>Deshacer</span>
          </button>
        </div>
      )}

      {/* Botones de acción */}
      {top && !resetting && (
        <div className="flex justify-center items-center gap-[26px] px-5 pt-2.5 pb-3 shrink-0">
          <button onClick={() => swipe(false)} aria-label="Paso" className="w-[58px] h-[58px] rounded-full bg-[#111118] border-[1.5px] border-[#26263a] text-[#4a4a62] flex items-center justify-center shrink-0"><X size={24} strokeWidth={2.5} /></button>
          <button onClick={() => swipe(true)} aria-label="Me gusta" className="w-[72px] h-[72px] rounded-full text-white flex items-center justify-center shrink-0 shadow-[0_6px_30px_rgba(109,40,217,.55)]" style={{ background: 'linear-gradient(135deg,#6d28d9,#8b5cf6)' }}><Heart size={30} fill="currentColor" /></button>
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
