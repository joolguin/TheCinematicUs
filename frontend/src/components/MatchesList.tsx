import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { api, type Movie } from '../api';
import { MatchDecider } from './MatchDecider';

export function MatchesList({ onClose, onChoose }: { onClose: () => void; onChoose: (m: Movie) => void }) {
  const [matches, setMatches] = useState<Movie[]>([]);
  const [deciding, setDeciding] = useState(false);
  useEffect(() => { api.get('/matches').then((r) => setMatches(r.matches)); }, []);

  return (
    <div className="fixed inset-0 z-[90] bg-theater">
      <div className="max-w-[430px] mx-auto h-full flex flex-col animate-slideUp">
        <div className="h-[60px] shrink-0" />
        <div className="flex justify-between items-center px-[18px] pt-2.5 pb-2 shrink-0 border-b border-whisper">
          <h2 className="font-display text-[20px] text-screen font-bold flex items-center gap-1.5">
            Matches <Heart size={20} color="#E0703C" fill="#E0703C" />
          </h2>
          <button onClick={onClose} className="text-reel-dim text-[16px] px-2 py-1">Cerrar</button>
        </div>

        {matches.length >= 2 && (
          <div className="px-3.5 pt-2.5 shrink-0">
            <button
              onClick={() => setDeciding(true)}
              className="w-full bg-ember text-theater rounded-[14px] py-[13px] text-[17px] font-semibold"
            >
              ¿Cuál vemos?
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3.5 pt-2.5 pb-6">
          {matches.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <div className="w-16 h-24 rounded-[10px] border border-whisper bg-charcoal" />
              <p className="text-reel text-[17px] leading-[1.65]">
                Todavía no hay matches.<br />¡Seguí swipeando!
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2.5 mt-2.5">
            {matches.map((m) => (
              <div key={m.id} className="rounded-[14px] overflow-hidden bg-charcoal relative aspect-[2/3]">
                <div
                  className="absolute inset-0 bg-cover bg-center"
                  style={{ backgroundImage: m.poster_url ? `url(${m.poster_url})` : 'none', backgroundColor: '#1F1F23' }}
                />
                <div className="absolute bottom-0 inset-x-0 px-2.5 py-2 bg-[linear-gradient(transparent,rgba(11,11,13,.92))]">
                  <p className="text-screen text-[14px] font-medium leading-[1.3] [text-wrap:pretty]">{m.title}</p>
                  {m.year && <p className="text-reel-dim text-[13px] font-mono mt-0.5">{m.year}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {deciding && (
        <MatchDecider matches={matches} onPick={onChoose} onClose={() => setDeciding(false)} />
      )}
    </div>
  );
}
