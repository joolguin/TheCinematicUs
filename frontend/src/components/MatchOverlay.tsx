import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../supabase';
import { api, type Movie } from '../api';
import { AVATAR, RING } from '../assets/avatars';

type Queued = { matchId: string; movie: Movie };

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

  useEffect(() => {
    const channel = supabase
      .channel('matches')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches' },
        async (payload) => {
          const current = sessionIdRef.current;
          if (!current) return;
          const row = payload.new as { id: string; session_id: string };
          if (row.session_id !== current) return;
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
          className="fixed inset-0 z-[100] bg-theater/95 flex flex-col items-center justify-center px-7 pt-5 pb-12 overflow-hidden"
        >
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[440px] h-[440px] rounded-full z-0 animate-bloom"
            style={{ background: 'radial-gradient(circle, var(--ember-bloom) 0%, transparent 68%)' }}
          />
          <p className="text-[14px] text-ember tracking-[0.22em] uppercase font-semibold mb-2.5 relative z-[1]">¡Es un match!</p>
          <div className="inline-flex gap-2.5 mb-3.5 relative z-[1] animate-heartbeat">
            <img src={AVATAR.Jo} className="w-[34px] h-[34px] rounded-full object-cover border-[1.5px]" style={{ borderColor: RING.Jo }} />
            <img src={AVATAR.Vale} className="w-[34px] h-[34px] rounded-full object-cover border-[1.5px]" style={{ borderColor: RING.Vale }} />
          </div>
          <div className="w-[158px] rounded-[16px] overflow-hidden mb-3.5 relative z-[1] shrink-0 animate-popIn shadow-[0_24px_48px_-12px_rgba(11,11,13,0.7)]">
            <div
              className="w-full aspect-[2/3] bg-cover bg-center"
              style={{ backgroundImage: current.movie.poster_url ? `url(${current.movie.poster_url})` : 'none', backgroundColor: 'var(--ink)' }}
            />
          </div>
          <motion.h3
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, type: 'spring', stiffness: 100, damping: 20 }}
            className="font-display text-[24px] text-screen font-semibold text-center leading-[1.2] mb-1 relative z-[1] [text-wrap:pretty]"
          >{current.movie.title}</motion.h3>
          <p className="font-mono text-[15px] text-reel mb-5 relative z-[1]">{current.movie.year ?? ''}</p>
          <div className="flex flex-col gap-[9px] w-full relative z-[1]">
            <button onClick={ver} className="bg-ember text-theater rounded-[14px] py-[15px] text-[18px] font-semibold">Ver esta noche</button>
            <button onClick={seguir} className="bg-charcoal text-reel border border-whisper rounded-[14px] py-[13px] text-[17px]">Seguir buscando</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
