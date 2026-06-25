// frontend/src/components/MatchesList.tsx
import { useEffect, useState } from 'react';
import { api, type Movie } from '../api';
import { MatchDecider } from './MatchDecider';

export function MatchesList({ onClose, onChoose }: { onClose: () => void; onChoose: (m: Movie) => void }) {
  const [matches, setMatches] = useState<Movie[]>([]);
  const [deciding, setDeciding] = useState(false);
  useEffect(() => { api.get('/matches').then((r) => setMatches(r.matches)); }, []);

  return (
    <div className="fixed inset-0 z-40 bg-neutral-950 p-4 overflow-y-auto">
      <div className="flex justify-between items-center mb-4 max-w-md mx-auto">
        <h2 className="text-xl">Matches de esta noche</h2>
        <button onClick={onClose} className="text-neutral-400">Cerrar</button>
      </div>

      {matches.length >= 2 && (
        <div className="max-w-md mx-auto mb-3">
          <button onClick={() => setDeciding(true)} className="w-full rounded-lg bg-rose-600 py-3 font-medium">
            🎲 ¿Cuál vemos?
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 max-w-md mx-auto">
        {matches.length === 0 && <p className="text-neutral-500 col-span-2">Todavía no hay matches.</p>}
        {matches.map((m) => (
          <div key={m.id} className="rounded-xl overflow-hidden bg-neutral-900">
            {m.poster_url && <img src={m.poster_url} className="w-full" />}
            <p className="p-2 text-sm">{m.title}</p>
          </div>
        ))}
      </div>

      {deciding && (
        <MatchDecider matches={matches} onPick={onChoose} onClose={() => setDeciding(false)} />
      )}
    </div>
  );
}
