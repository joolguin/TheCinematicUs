// frontend/src/components/MatchOverlay.tsx
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../supabase';
import { api, type Movie } from '../api';

export function MatchOverlay({ onCount }: { onCount: () => void }) {
  const [movie, setMovie] = useState<Movie | null>(null);

  useEffect(() => {
    // Suscripción Realtime: el match aparece en AMBAS pantallas al instante.
    const channel = supabase
      .channel('matches')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches' },
        async (payload) => {
          const movieId = (payload.new as any).movie_id;
          const { matches } = await api.get('/matches');
          const m = (matches as Movie[]).find((x) => x.id === movieId);
          if (m) { setMovie(m); onCount(); }
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [onCount]);

  return (
    <AnimatePresence>
      {movie && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center gap-4 p-6"
        >
          <div className="text-4xl">🐭 ¡Match! 🦆</div>
          {movie.poster_url && <img src={movie.poster_url} className="max-h-[50vh] rounded-xl" />}
          <h3 className="text-2xl font-semibold text-center">{movie.title}</h3>
          <div className="flex gap-4">
            <button onClick={() => setMovie(null)} className="rounded-lg bg-neutral-800 px-5 py-3">Seguir buscando</button>
            <button onClick={() => setMovie(null)} className="rounded-lg bg-rose-600 px-5 py-3 font-medium">Ver esta</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
