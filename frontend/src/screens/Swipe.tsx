// frontend/src/screens/Swipe.tsx
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { supabase } from '../supabase';
import { api, type Movie } from '../api';
import type { UserName, PresenceStatus } from '../types';
import { PresenceBadge } from '../components/PresenceBadge';
import { MovieCard } from '../components/MovieCard';
import { MatchOverlay } from '../components/MatchOverlay';
// Se carga solo al abrir el modal de matches (no se necesita en el primer paint).
const MatchesList = lazy(() =>
  import('../components/MatchesList').then((m) => ({ default: m.MatchesList })),
);

export function Swipe({ user, onSwitch, onImport }: { user: UserName; onSwitch: () => void; onImport: () => void }) {
  const [deck, setDeck] = useState<Movie[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [showMatches, setShowMatches] = useState(false);
  const [chosen, setChosen] = useState<Movie | null>(null);
  const [deckLoaded, setDeckLoaded] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  const opacity = useTransform(x, [-200, 0, 200], [0.5, 1, 0.5]);

  useEffect(() => {
    api.get(`/deck?user=${user}`).then((r) => { setDeck(r.deck); setDeckLoaded(true); });
  }, [user]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // Contador real + sessionId actual (baseline de la suscripción y scoping de matches vistos).
  useEffect(() => {
    api.get('/matches').then((r) => { setMatchCount(r.matches.length); setSessionId(r.sessionId); });
  }, []);

  // Reacomoda la pantalla a la sesión `id` sin recargar la página.
  function softReset(id: string) {
    setExpanded(false);
    setShowMatches(false);
    setChosen(null);
    setMatchCount(0);
    setSessionId(id);
    x.set(0);
    setDeckLoaded(false);
    api.get(`/deck?user=${user}`).then((r) => { setDeck(r.deck); setDeckLoaded(true); });
  }

  // En vivo: si la otra inicia una noche nueva, avisar y reacomodar.
  useEffect(() => {
    const channel = supabase
      .channel('sessions')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessions' },
        (payload) => {
          const nueva = payload.new as { id: string; started_by: string | null };
          if (nueva.id === sessionIdRef.current) return;       // ya es la sesión actual
          if (nueva.started_by === user) return;    // la inicié yo: ya hice soft reset local
          setAviso(`${nueva.started_by ?? 'Alguien'} empezó una noche nueva`);
          softReset(nueva.id);
          setTimeout(() => setAviso(null), 4000);
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

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
    setExpanded(false);
    x.set(0);
    // No incrementamos acá: el contador lo maneja SOLO el Realtime (MatchOverlay.onCount).
    await api.post('/swipe', { user, movieId: movie.id, liked });
  }

  return (
    <div className="min-h-screen flex flex-col p-4 max-w-md mx-auto">
      {aviso && (
        <div className="fixed top-3 inset-x-0 z-40 mx-auto w-fit rounded-full bg-neutral-800 px-4 py-2 text-sm shadow-lg">
          {aviso}
        </div>
      )}
      <header className="flex justify-between items-center py-2">
        <div className="flex items-center gap-2">
          <span className="text-neutral-500">{user}</span>
          <button onClick={onSwitch} className="text-xs text-neutral-500 underline">cambiar</button>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={confirmarNuevaSesion} className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm">🔄 Nueva sesión</button>
          <button onClick={() => setShowMatches(true)} className="text-lg">❤️ {matchCount}</button>
        </div>
      </header>
      <PresenceBadge me={user} myStatus={myStatus} />

      <div className="flex-1 relative">
        {top ? (
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
            <div className="text-sm text-neutral-500">¿Sesión nueva o sin películas? Importa tu watchlist.</div>
            <button onClick={onImport} className="rounded-lg bg-neutral-800 px-4 py-2 text-sm">Importar películas</button>
          </div>
        )}
      </div>

      {top && (
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
          <MatchesList onClose={() => setShowMatches(false)} />
        </Suspense>
      )}
    </div>
  );
}
