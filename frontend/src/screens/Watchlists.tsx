import { useEffect, useState } from 'react';
import { api } from '../api';
import { supabase } from '../supabase';

type RefreshResult = { count: number; ok: boolean; error?: string };
type RefreshStatus = {
  status: 'idle' | 'running' | 'done' | 'error';
  result:
    | (Record<string, RefreshResult> & {
        reenriched?: { attempted: number; enriched: number };
        error?: string;
      })
    | null;
};

export function Watchlists({ onDone }: { onDone: () => void }) {
  const [status, setStatus] = useState<RefreshStatus>({ status: 'idle', result: null });

  useEffect(() => {
    // Estado actual al abrir la pantalla.
    supabase.from('refresh_status').select('status, result').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (data) setStatus(data as RefreshStatus); });
    // En vivo: el backend escribe refresh_status cuando termina.
    const channel = supabase
      .channel('refresh_status')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'refresh_status' },
        (payload) => setStatus(payload.new as RefreshStatus))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function refresh() {
    await api.post('/watchlists/refresh', {});
    // El estado real llega por Realtime; mostramos 'running' optimista.
    setStatus((s) => ({ ...s, status: 'running' }));
  }

  const running = status.status === 'running';
  const entries = status.result
    ? (Object.entries(status.result).filter(
        ([k]) => k !== 'reenriched' && k !== 'error',
      ) as [string, RefreshResult][])
    : [];

  return (
    <div className="min-h-screen flex flex-col gap-4 p-6 max-w-md mx-auto">
      <h2 className="text-xl">Watchlists de Letterboxd</h2>
      <p className="text-sm text-neutral-500">
        Trae el pozo desde las watchlists públicas. Corre en segundo plano; te aviso cuando termina.
      </p>

      <button
        onClick={refresh}
        disabled={running}
        className="rounded-lg bg-rose-600 px-6 py-3 font-medium disabled:opacity-40"
      >
        {running ? 'Actualizando…' : 'Actualizar watchlists'}
      </button>

      {running && <p className="text-sm text-neutral-400">Actualizando en segundo plano…</p>}

      {(status.status === 'done' || status.status === 'error') && (
        <div className="flex flex-col gap-1 text-sm">
          {entries.map(([name, r]) => (
            <p key={name} className={r.ok ? 'text-neutral-300' : 'text-amber-400'}>
              {r.ok
                ? `${name}: ${r.count} ✓`
                : `${name}: error — se mantuvo la lista anterior${r.error ? ` (${r.error})` : ''}`}
            </p>
          ))}
          {status.status === 'error' && status.result?.error && (
            <p className="text-amber-400">error — {status.result.error}</p>
          )}
          {status.result?.reenriched && (
            <p className="text-neutral-500">re-enriquecidas: {status.result.reenriched.enriched}</p>
          )}
        </div>
      )}

      <button
        onClick={onDone}
        disabled={running}
        className="mt-2 rounded-lg bg-emerald-600 px-6 py-3 font-medium text-neutral-100 disabled:opacity-40"
      >
        Empezar a swipear
      </button>
    </div>
  );
}
