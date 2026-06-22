// frontend/src/screens/Import.tsx
import { useState } from 'react';
import { api } from '../api';
import type { UserName } from '../types';

export function Import({ user, onDone }: { user: UserName; onDone: () => void }) {
  const [titles, setTitles] = useState('');
  const [result, setResult] = useState<{ imported: number; minimal: number } | null>(null);
  const [loading, setLoading] = useState(false);

  async function importTitles() {
    setLoading(true);
    try {
      setResult(await api.post('/import', { user, titles }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col gap-4 p-6 max-w-md mx-auto">
      <h2 className="text-xl">Pegá tu watchlist, una por línea</h2>
      <p className="text-sm text-neutral-500">Formato: <code>Título (Año)</code></p>
      <textarea
        value={titles}
        onChange={(e) => setTitles(e.target.value)}
        rows={10}
        placeholder={'Parasite (2019)\nDrive (2011)\nAmelie (2001)'}
        className="rounded-lg bg-neutral-900 p-3 font-mono text-sm outline-none"
      />
      <button
        onClick={importTitles}
        disabled={loading || !titles.trim()}
        className="rounded-lg bg-rose-600 px-6 py-3 font-medium disabled:opacity-40"
      >
        {loading ? 'Importando…' : 'Importar'}
      </button>
      {result && (
        <div className="text-sm text-neutral-400">
          <p>Importadas: {result.imported} ({result.minimal} sin datos de TMDB)</p>
          <button onClick={onDone} className="mt-3 rounded-lg bg-emerald-600 px-6 py-3 font-medium text-neutral-100">
            Empezar a swipear
          </button>
        </div>
      )}
    </div>
  );
}
