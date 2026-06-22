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
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  const opacity = useTransform(x, [-200, 0, 200], [0.5, 1, 0.5]);

  useEffect(() => { api.get(`/deck?user=${user}`).then((r) => setDeck(r.deck)); }, [user]);

  const top = deck[0];

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
        <button onClick={() => setShowMatches(true)} className="text-lg">❤️ {matchCount}</button>
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

      <MatchOverlay onCount={() => setMatchCount((c) => c + 1)} />
      {showMatches && <MatchesList onClose={() => setShowMatches(false)} />}
    </div>
  );
}
