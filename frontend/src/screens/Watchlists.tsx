// frontend/src/screens/Watchlists.tsx
import { useState } from 'react';
import { api } from '../api';

type RefreshResult = { count: number; ok: boolean; error?: string };
type RefreshResponse = Record<string, RefreshResult>;

export function Watchlists({ onDone }: { onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RefreshResponse | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setResult(await api.post('/watchlists/refresh', {}));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col gap-4 p-6 max-w-md mx-auto">
      <h2 className="text-xl">Watchlists de Letterboxd</h2>
      <p className="text-sm text-neutral-500">
        Trae el pozo de películas desde las watchlists públicas. La primera vez puede tardar.
      </p>

      <button
        onClick={refresh}
        disabled={loading}
        className="rounded-lg bg-rose-600 px-6 py-3 font-medium disabled:opacity-40"
      >
        {loading ? 'Actualizando…' : 'Actualizar watchlists'}
      </button>

      {result && (
        <div className="flex flex-col gap-1 text-sm">
          {Object.entries(result).map(([name, r]) => (
            <p key={name} className={r.ok ? 'text-neutral-300' : 'text-amber-400'}>
              {r.ok
                ? `${name}: ${r.count} ✓`
                : `${name}: error — se mantuvo la lista anterior${r.error ? ` (${r.error})` : ''}`}
            </p>
          ))}
        </div>
      )}

      <button
        onClick={onDone}
        disabled={loading}
        className="mt-2 rounded-lg bg-emerald-600 px-6 py-3 font-medium text-neutral-100 disabled:opacity-40"
      >
        Empezar a swipear
      </button>
    </div>
  );
}
