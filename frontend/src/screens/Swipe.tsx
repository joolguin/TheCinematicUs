// frontend/src/screens/Swipe.tsx
import { useEffect, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { api, type Movie } from '../api';
import type { UserName } from '../types';
import { MovieCard } from '../components/MovieCard';
import { MatchOverlay } from '../components/MatchOverlay';
import { MatchesList } from '../components/MatchesList';

export function Swipe({ user }: { user: UserName }) {
  const [deck, setDeck] = useState<Movie[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [showMatches, setShowMatches] = useState(false);
  const [chosen, setChosen] = useState<Movie | null>(null);
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  const opacity = useTransform(x, [-200, 0, 200], [0.5, 1, 0.5]);

  useEffect(() => { api.get(`/deck?user=${user}`).then((r) => setDeck(r.deck)); }, [user]);

  // El contador arranca con el total real de matches de la sesión (no solo los de esta carga).
  useEffect(() => { api.get('/matches').then((r) => setMatchCount(r.matches.length)); }, []);

  // Empezar una noche nueva: resetea el mazo (el match es efímero) y recarga.
  async function nuevaSesion() {
    await api.post('/session', {});
    window.location.reload();
  }

  // Desde el header pedimos confirmación: reinicia la noche para las dos.
  async function confirmarNuevaSesion() {
    if (window.confirm('¿Empezar una sesión nueva? Se reinicia el mazo y los matches de esta noche para las dos.')) {
      await nuevaSesion();
    }
  }

  const top = deck[0];

  // Película elegida: pantalla final, en vez de caer en "terminaste tu mazo".
  if (chosen) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-5 p-6 text-center">
        <div className="text-3xl">🎬 ¡Esta noche ven!</div>
        {chosen.poster_url && <img src={chosen.poster_url} className="max-h-[55vh] rounded-xl" />}
        <h2 className="text-2xl font-semibold">{chosen.title} {chosen.year && <span className="text-neutral-500">({chosen.year})</span>}</h2>
        <div className="text-2xl">🐭 🍿 🦆</div>
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
    // No incrementamos acá: el contador lo maneja SOLO el Realtime (MatchOverlay.onCount),
    // así ambas pantallas cuentan igual y no se duplica para quien dispara el match.
    await api.post('/swipe', { user, movieId: movie.id, liked });
  }

  return (
    <div className="min-h-screen flex flex-col p-4 max-w-md mx-auto">
      <header className="flex justify-between items-center py-2">
        <span className="text-neutral-500">{user}</span>
        <div className="flex items-center gap-3">
          <button onClick={confirmarNuevaSesion} className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm">🔄 Nueva sesión</button>
          <button onClick={() => setShowMatches(true)} className="text-lg">❤️ {matchCount}</button>
        </div>
      </header>

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
          <div className="absolute inset-0 flex items-center justify-center text-center text-neutral-500">
            Terminaste tu mazo. La otra sigue eligiendo… 🍿
          </div>
        )}
      </div>

      {top && (
        <div className="flex justify-center gap-8 py-4">
          <button onClick={() => swipe(false)} className="h-16 w-16 rounded-full bg-neutral-800 text-2xl">👎</button>
          <button onClick={() => swipe(true)} className="h-16 w-16 rounded-full bg-rose-600 text-2xl">👍</button>
        </div>
      )}

      <MatchOverlay onCount={() => setMatchCount((c) => c + 1)} onChoose={setChosen} />
      {showMatches && <MatchesList onClose={() => setShowMatches(false)} />}
    </div>
  );
}
