// frontend/src/screens/Import.tsx
import { useState } from 'react';
import { api } from '../api';
import type { UserName } from '../types';
import { useSessionListener } from '../hooks';

export function Import({ user, onDone }: { user: UserName; onDone: () => void }) {
  const [titles, setTitles] = useState('');
  const [result, setResult] = useState<{ imported: number; minimal: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [deckReloadPending, setDeckReloadPending] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Listen for session changes from the other user; reload deck on change.
  useSessionListener(user, currentSessionId, (newSessionId) => {
    setCurrentSessionId(newSessionId);
  });

  async function importTitles() {
    setLoading(true);
    try {
      const importResult = await api.post('/import', { user, titles });
      setResult(importResult);
      // Initialize session tracking if not already set
      if (!currentSessionId) {
        const matches = await api.get('/matches');
        setCurrentSessionId(matches.sessionId);
      }
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
      <div className="flex gap-3">
        <button
          onClick={importTitles}
          disabled={loading || !titles.trim()}
          className="flex-1 rounded-lg bg-rose-600 px-6 py-3 font-medium disabled:opacity-40"
        >
          {loading ? 'Importando…' : 'Importar'}
        </button>
        {!result && (
          <button
            onClick={async () => {
              setDeckReloadPending(true);
              try {
                const matches = await api.get('/matches');
                setCurrentSessionId(matches.sessionId);
              } finally {
                setDeckReloadPending(false);
              }
            }}
            disabled={loading || !titles.trim()}
            className="rounded-lg bg-neutral-800 px-6 py-3 font-medium disabled:opacity-40 text-sm"
          >
            {deckReloadPending ? 'Recargando…' : '🔄'}
          </button>
        )}
      </div>
      {result && (
        <div className="text-sm text-neutral-400">
          <p>Importadas: {result.imported} ({result.minimal} sin datos de TMDB)</p>
          <button onClick={onDone} disabled={deckReloadPending} className="mt-3 rounded-lg bg-emerald-600 px-6 py-3 font-medium text-neutral-100 disabled:opacity-40">
            {deckReloadPending ? 'Recargando…' : 'Empezar a swipear'}
          </button>
          {deckReloadPending && <p className="mt-2 text-xs text-neutral-500">Actualizando mazo en el otro dispositivo…</p>}
        </div>
      )}
    </div>
  );
}
