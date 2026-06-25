// frontend/src/screens/Swipe.tsx
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { api, type Movie, type SessionFilters, type DeckResponse } from '../api';
import type { UserName, PresenceStatus } from '../types';
import { useSessionListener } from '../hooks';
import { PresenceBadge } from '../components/PresenceBadge';
import { MovieCard } from '../components/MovieCard';
import { MatchOverlay } from '../components/MatchOverlay';
import { FilterBar } from '../components/FilterBar';
// Se carga solo al abrir el modal de matches (no se necesita en el primer paint).
const MatchesList = lazy(() =>
  import('../components/MatchesList').then((m) => ({ default: m.MatchesList })),
);

export function Swipe({ user, onSwitch, onWatchlists }: { user: UserName; onSwitch: () => void; onWatchlists: () => void }) {
  const [deck, setDeck] = useState<Movie[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [showMatches, setShowMatches] = useState(false);
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
    setChosen(null);
    setMatchCount(0);
    setSessionId(id);
    setLastSwiped(null);
    x.set(0);
    const quien = by ? `${by} empezó una noche nueva` : 'Empezaste una noche nueva';
    setResetMsg(`♻️ ${quien} · reiniciando mazo…`);
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

  // Película elegida: pantalla final, en vez de caer en "terminaste tu mazo".
  if (chosen) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-5 p-6 text-center">
        <div className="text-3xl">🎬 ¡Esta noche ven!</div>
        {chosen.poster_url && <img src={chosen.poster_url} className="max-h-[55vh] rounded-xl" />}
        <h2 className="text-2xl font-semibold">{chosen.title} {chosen.year && <span className="text-neutral-500">({chosen.year})</span>}</h2>
        <div className="text-2xl">🍿</div>
        <div className="flex gap-4 mt-2">
          <button onClick={() => setChosen(null)} className="rounded-lg bg-neutral-800 px-5 py-3">Volver a elegir</button>
          <button onClick={nuevaSesion} className="rounded-lg bg-rose-600 px-5 py-3 font-medium">Nueva sesión</button>
        </div>
      </div>
    );
  }

  async function swipe(liked: boolean) {
    if (!top) return;
    const movie = top;
    setDeck((d) => d.slice(1));
    setLastSwiped(movie);
    setExpanded(false);
    x.set(0);
    // No incrementamos acá: el contador lo maneja SOLO el Realtime (MatchOverlay.onCount).
    await api.post('/swipe', { user, movieId: movie.id, liked });
  }

  // Deshace el último swipe (single-level): vuelve la card arriba del mazo y
  // borra el swipe en el backend (que también reconcilia el match si lo rompe).
  async function undo() {
    if (!lastSwiped) return;
    const movie = lastSwiped;
    setLastSwiped(null);
    setDeck((d) => [movie, ...d]);
    x.set(0);
    await api.post('/swipe/undo', { user, movieId: movie.id });
  }

  return (
    <div className="min-h-screen flex flex-col p-4 max-w-md mx-auto">
      {aviso && (
        <div className="fixed top-3 inset-x-0 z-40 mx-auto w-fit rounded-full bg-neutral-800 px-4 py-2 text-sm shadow-lg">
          {aviso}
        </div>
      )}
      {resetMsg && (
        <div className="fixed top-3 inset-x-0 z-50 mx-auto w-fit rounded-full bg-rose-600 px-4 py-2 text-sm font-medium shadow-lg">
          {resetMsg}
        </div>
      )}
      <header className="flex justify-between items-center py-2">
        <div className="flex items-center gap-2">
          <span className="text-neutral-500">{user}</span>
          <button onClick={onSwitch} className="text-xs text-neutral-500 underline">cambiar</button>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onWatchlists} className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm">🎬 Watchlists</button>
          <button onClick={confirmarNuevaSesion} className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm">🔄 Nueva sesión</button>
          <button onClick={() => setShowMatches(true)} className="text-lg">❤️ {matchCount}</button>
        </div>
      </header>
      <PresenceBadge me={user} myStatus={myStatus} />
      <FilterBar genres={genres} filters={filters} onChange={applyLocalFilter} />
      {deckLoaded && deck.length > 0 && (
        <div className="text-center text-xs text-neutral-500 pb-1">
          {deck.length} {deck.length === 1 ? 'peli' : 'pelis'} por ver
        </div>
      )}

      <div className="flex-1 relative">
        {resetting ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-neutral-400">
            <div className="text-2xl animate-pulse">♻️</div>
            <div>Reiniciando mazo…</div>
          </div>
        ) : top ? (
          <motion.div
            key={top.id}
            style={{ x, rotate, opacity }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={(_, info) => {
              if (info.offset.x > 120) swipe(true);
              else if (info.offset.x < -120) swipe(false);
            }}
            className="absolute inset-0"
          >
            <MovieCard movie={top} expanded={expanded} onToggle={() => setExpanded((e) => !e)} />
          </motion.div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center text-neutral-400 p-6">
            <div>No quedan películas por swipear en esta sesión 🍿</div>
            {matchCount > 0 && (
              <button onClick={() => setShowMatches(true)} className="rounded-lg bg-rose-600 px-5 py-3 font-medium">
                Ver {matchCount} {matchCount === 1 ? 'match' : 'matches'}
              </button>
            )}
            <div className="text-sm text-neutral-500">¿Sesión nueva o pozo vacío? Actualizá las watchlists.</div>
            <button onClick={onWatchlists} className="rounded-lg bg-neutral-800 px-4 py-2 text-sm">Actualizar watchlists</button>
          </div>
        )}
      </div>

      {lastSwiped && !resetting && (
        <div className="flex justify-center pb-2">
          <button onClick={undo} className="text-sm text-neutral-400 underline">↩ Deshacer</button>
        </div>
      )}

      {top && !resetting && (
        <div className="flex justify-center gap-8 py-4">
          <button onClick={() => swipe(false)} aria-label="Paso" className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-800">
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <button onClick={() => swipe(true)} aria-label="Me gusta" className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-600">
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </button>
        </div>
      )}

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
