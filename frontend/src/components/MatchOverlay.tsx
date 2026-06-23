// frontend/src/components/MatchOverlay.tsx
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../supabase';
import { api, type Movie } from '../api';

// Un match en cola para mostrar: el id del match + los datos de la peli.
type Queued = { matchId: string; movie: Movie };

// Registro local de matches ya mostrados en ESTE dispositivo (para no repetirlos).
function getSeen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('seenMatches') ?? '[]')); }
  catch { return new Set(); }
}
function markSeen(matchId: string) {
  const s = getSeen();
  s.add(matchId);
  localStorage.setItem('seenMatches', JSON.stringify([...s]));
}

// /matches devuelve [{ matchId, ...camposDePeli }]
async function fetchMatches(): Promise<Queued[]> {
  const { matches } = await api.get('/matches');
  return (matches as (Movie & { matchId: string })[]).map((m) => ({ matchId: m.matchId, movie: m }));
}

export function MatchOverlay({ onCount, onChoose }: { onCount: () => void; onChoose: (m: Movie) => void }) {
  const [queue, setQueue] = useState<Queued[]>([]);

  function enqueue(items: Queued[]) {
    setQueue((q) => {
      const known = new Set(q.map((x) => x.matchId));
      const nuevos = items.filter((x) => !known.has(x.matchId));
      return nuevos.length ? [...q, ...nuevos] : q;
    });
  }

  // Robustez: al entrar, encolar los matches de la sesión que todavía NO viste,
  // aunque la otra se haya adelantado mientras no estabas en esta pantalla.
  useEffect(() => {
    let active = true;
    fetchMatches().then((all) => {
      if (!active) return;
      const seen = getSeen();
      enqueue(all.filter((q) => !seen.has(q.matchId)));
    });
    return () => { active = false; };
  }, []);

  // En vivo: cuando se crea un match, aparece al instante en ambas pantallas.
  useEffect(() => {
    const channel = supabase
      .channel('matches')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches' },
        async (payload) => {
          const matchId = (payload.new as any).id as string;
          if (getSeen().has(matchId)) return;
          const all = await fetchMatches();
          const found = all.find((q) => q.matchId === matchId);
          if (found) { enqueue([found]); onCount(); }
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [onCount]);

  const current = queue[0];

  function next() { setQueue((q) => q.slice(1)); }
  function seguir() { if (current) markSeen(current.matchId); next(); }
  function ver() { if (current) { markSeen(current.matchId); onChoose(current.movie); } next(); }

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.matchId}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center gap-4 p-6"
        >
          <div className="text-4xl">🐭 ¡Match! 🦆</div>
          {current.movie.poster_url && <img src={current.movie.poster_url} className="max-h-[50vh] rounded-xl" />}
          <h3 className="text-2xl font-semibold text-center">{current.movie.title}</h3>
          <div className="flex gap-4">
            <button onClick={seguir} className="rounded-lg bg-neutral-800 px-5 py-3">Seguir buscando</button>
            <button onClick={ver} className="rounded-lg bg-rose-600 px-5 py-3 font-medium">Ver esta</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
