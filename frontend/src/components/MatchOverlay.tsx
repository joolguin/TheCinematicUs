// frontend/src/components/MatchOverlay.tsx
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../supabase';
import { api, type Movie } from '../api';
import { AVATAR, RING } from '../assets/avatars';

// Confetti determinista (mismo patrón que el prototipo), calculado una vez.
const CONFETTI: CSSProperties[] = Array.from({ length: 28 }, (_, i) => {
  const r = (n: number) => Math.abs(Math.sin(i * 9.301 + n * 49.756 + 1));
  const colors = ['#7c3aed', '#a78bfa', '#ddd6fe', '#f9a8d4', '#fbbf24', '#34d399', '#60a5fa'];
  return {
    position: 'absolute',
    top: '-20px',
    left: `${4 + r(1) * 92}%`,
    width: `${4 + r(2) * 8}px`,
    height: `${3 + r(3) * 5}px`,
    background: colors[Math.floor(r(4) * 7)],
    animation: `confFall ${0.6 + r(5) * 0.6}s ${r(6) * 0.6}s ease-in both`,
    borderRadius: '2px',
    pointerEvents: 'none',
    zIndex: 110,
  } as CSSProperties;
});

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
          className="fixed inset-0 z-[100] bg-[rgba(9,9,14,.96)] flex flex-col items-center justify-center px-7 pt-5 pb-12 overflow-hidden"
        >
          <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
            {CONFETTI.map((s, i) => <div key={i} style={s} />)}
          </div>
          <p className="text-[14px] text-[#7c3aed] tracking-[0.22em] uppercase font-semibold mb-2.5 relative z-[1]">¡Es un match!</p>
          <div className="inline-flex gap-2.5 mb-3.5 relative z-[1] [animation:heartbeat_1.4s_ease-in-out_infinite]">
            <img src={AVATAR.Jo} className="w-[34px] h-[34px] rounded-full object-cover border-[1.5px]" style={{ borderColor: RING.Jo }} />
            <img src={AVATAR.Vale} className="w-[34px] h-[34px] rounded-full object-cover border-[1.5px]" style={{ borderColor: RING.Vale }} />
          </div>
          <div className="w-[158px] rounded-[16px] overflow-hidden mb-3.5 relative z-[1] shrink-0 [animation:glowPulse_2.5s_ease_infinite,popIn_.5s_.1s_ease_both]">
            <div
              className="w-full aspect-[2/3] bg-cover bg-center"
              style={{ backgroundImage: current.movie.poster_url ? `url(${current.movie.poster_url})` : 'none', backgroundColor: '#1a1a2e' }}
            />
          </div>
          <h3 className="font-display text-[21px] text-[#f8f8fa] font-bold text-center leading-[1.2] mb-1 relative z-[1] [text-wrap:pretty]">{current.movie.title}</h3>
          <p className="text-[16px] text-[#3a3a50] mb-5 relative z-[1]">{current.movie.year ? `(${current.movie.year})` : ''}</p>
          <div className="flex flex-col gap-[9px] w-full relative z-[1]">
            <button onClick={ver} className="text-white rounded-[14px] py-[15px] text-[18px] font-semibold shadow-[0_6px_28px_rgba(109,40,217,.5)]" style={{ background: 'linear-gradient(135deg,#6d28d9,#8b5cf6)' }}>Ver esta noche</button>
            <button onClick={seguir} className="bg-[#111118] text-[#5a5a72] border-[1.5px] border-[#26263a] rounded-[14px] py-[13px] text-[17px]">Seguir buscando</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
