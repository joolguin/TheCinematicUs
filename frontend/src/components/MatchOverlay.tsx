// frontend/src/components/MatchOverlay.tsx
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../supabase';
import { api, type Movie } from '../api';

// Un match en cola para mostrar: el id del match + los datos de la peli.
type Queued = { matchId: string; movie: Movie };

// Matches ya mostrados en ESTE dispositivo, scopeados por sesión (no se arrastran entre noches).
function seenKey(sessionId: string) { return `seenMatches:${sessionId}`; }
function getSeen(sessionId: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(seenKey(sessionId)) ?? '[]')); }
  catch { return new Set(); }
}
function markSeen(sessionId: string, matchId: string) {
  const s = getSeen(sessionId);
  s.add(matchId);
  localStorage.setItem(seenKey(sessionId), JSON.stringify([...s]));
}

// /matches devuelve { sessionId, matches: [{ matchId, ...camposDePeli }] }
async function fetchMatches(): Promise<{ sessionId: string; items: Queued[] }> {
  const { sessionId, matches } = await api.get('/matches');
  const items = (matches as (Movie & { matchId: string })[]).map((m) => ({ matchId: m.matchId, movie: m }));
  return { sessionId, items };
}

export function MatchOverlay({ sessionId, onCount, onChoose }: { sessionId: string | null; onCount: () => void; onChoose: (m: Movie) => void }) {
  const [queue, setQueue] = useState<Queued[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  function enqueue(items: Queued[]) {
    setQueue((q) => {
      const known = new Set(q.map((x) => x.matchId));
      const nuevos = items.filter((x) => !known.has(x.matchId));
      return nuevos.length ? [...q, ...nuevos] : q;
    });
  }

  // Al entrar o al cambiar de sesión (noche nueva): limpiar la cola y encolar los no vistos.
  useEffect(() => {
    if (!sessionId) return;
    setQueue([]);
    let active = true;
    fetchMatches().then(({ items }) => {
      if (!active) return;
      const seen = getSeen(sessionId);
      enqueue(items.filter((q) => !seen.has(q.matchId)));
    });
    return () => { active = false; };
  }, [sessionId]);

  // En vivo: un match nuevo de ESTA sesión aparece al instante en ambas pantallas.
  useEffect(() => {
    const channel = supabase
      .channel('matches')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches' },
        async (payload) => {
          const current = sessionIdRef.current;
          if (!current) return;
          const row = payload.new as { id: string; session_id: string };
          if (row.session_id !== current) return;     // match de otra sesión: ignorar
          if (getSeen(current).has(row.id)) return;
          const { items } = await fetchMatches();
          const found = items.find((q) => q.matchId === row.id);
          if (found) { enqueue([found]); onCount(); }
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const current = queue[0];

  function next() { setQueue((q) => q.slice(1)); }
  function seguir() { if (current && sessionId) markSeen(sessionId, current.matchId); next(); }
  function ver() { if (current && sessionId) { markSeen(sessionId, current.matchId); onChoose(current.movie); } next(); }

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
