import { useEffect, useState } from 'react';
import { RotateCcw, ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { api } from '../api';
import { supabase } from '../supabase';
import type { UserName } from '../types';
import { AVATAR, RING } from '../assets/avatars';

type RefreshResult = { count: number; ok: boolean; error?: string };
type RefreshStatus = {
  status: 'idle' | 'running' | 'done' | 'error';
  result:
    | (Record<string, RefreshResult> & {
        reenriched?: { attempted: number; enriched: number };
        error?: string;
      })
    | null;
  finished_at?: string | null;
};

function dotColor(name: string): string {
  return RING[name as UserName] ?? '#a78bfa';
}

// "30 jun 2026, 14:05" — última vez que terminó de actualizarse el pozo.
function formatUpdated(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString('es-AR', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function Watchlists({ user, onDone, onSwitch }: { user: UserName; onDone: () => void; onSwitch: () => void }) {
  const [status, setStatus] = useState<RefreshStatus>({ status: 'idle', result: null });

  useEffect(() => {
    // Estado actual al abrir la pantalla.
    supabase.from('refresh_status').select('status, result, finished_at').eq('id', 1).maybeSingle()
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
  const settled = status.status === 'done' || status.status === 'error';
  const entries = status.result
    ? (Object.entries(status.result).filter(
        ([k]) => k !== 'reenriched' && k !== 'error',
      ) as [string, RefreshResult][])
    : [];
  const reenriched = status.result?.reenriched;
  const lastUpdated = formatUpdated(status.finished_at);

  const updateBtn = (
    <button
      onClick={refresh}
      className="bg-[#111118] text-[#a78bfa] border-[1.5px] border-[#26263a] rounded-[14px] py-[14px] text-[14px] font-medium flex items-center justify-center gap-2"
    >
      <RotateCcw size={15} /> Actualizar watchlists
    </button>
  );

  const startBtn = (
    <button
      onClick={onDone}
      disabled={running}
      className="bg-[#7c3aed] text-white rounded-[14px] py-[15px] text-[15px] font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5"
    >
      Empezar a swipear <ArrowRight size={16} />
    </button>
  );

  return (
    <div className="min-h-screen max-w-[430px] mx-auto flex flex-col px-[18px] pt-3 pb-5 overflow-y-auto animate-fadeUp">
      <div className="mb-[22px]">
        <button onClick={onDone} className="text-[#4a4a62] text-[13px] py-1 flex items-center gap-1"><ArrowLeft size={14} />Volver</button>
      </div>

      <div className="flex items-center gap-2.5 mb-1.5">
        <img
          src={AVATAR[user]}
          className="w-[30px] h-[30px] rounded-full object-cover border-[1.5px]"
          style={{ borderColor: RING[user] }}
        />
        <div className="flex-1">
          <p className="text-[11px] text-[#3a3a50] mb-0.5">Hola, {user}</p>
          <h2 className="font-display text-[22px] text-[#f8f8fa] font-bold">Watchlists</h2>
        </div>
        <button onClick={onSwitch} className="text-[12px] text-[#4a4a62] py-1">Cambiar usuaria</button>
      </div>
      <p className="text-[13px] text-[#4a4a62] leading-[1.65] mb-[22px]">
        El pozo se llena con las watchlists públicas de Letterboxd de las dos. Podés actualizarlas en
        cualquier momento.
      </p>

      {/* Estado inactivo: mostramos el último recuento conocido si lo hay. */}
      {!running && !settled && (
        <div className="flex flex-col gap-2.5">
          <div className="bg-[#111118] border-[1.5px] border-[#26263a] rounded-[16px] px-[18px] py-4">
            {lastUpdated && (
              <p className="text-[#4a4a62] text-[13px] mb-3">Última actualización: {lastUpdated}</p>
            )}
            {entries.length > 0 ? (
              entries.map(([name, r]) => (
                <div key={name} className="flex justify-between mb-1.5 last:mb-0">
                  <span className="text-[#f8f8fa] text-[14px] font-medium">
                    <span
                      className="inline-block w-[7px] h-[7px] rounded-full mr-[7px] align-middle"
                      style={{ background: dotColor(name) }}
                    />
                    {name}
                  </span>
                  <span className="text-[#6b6b82] text-[13px]">{r.count} películas</span>
                </div>
              ))
            ) : (
              <p className="text-[#4a4a62] text-[13px]">
                Todavía no cargaste las watchlists. Actualizá para traer el pozo.
              </p>
            )}
          </div>
          {updateBtn}
          {startBtn}
        </div>
      )}

      {running && (
        <div className="flex flex-col gap-3 animate-fadeIn">
          <div className="bg-[#111118] border-[1.5px] border-[#26263a] rounded-[16px] p-[18px] flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <Loader2 size={16} className="animate-spin text-[#7c3aed] shrink-0" />
              <p className="text-[#a78bfa] text-[14px] font-medium">Actualizando en segundo plano…</p>
            </div>
            {(entries.length > 0 ? entries.map(([n]) => n) : ['Jo', 'Vale']).map((name) => (
              <div key={name} className="flex justify-between">
                <span className="text-[#6b6b82] text-[13px]">
                  <span
                    className="inline-block w-[7px] h-[7px] rounded-full mr-[7px] align-middle"
                    style={{ background: dotColor(name) }}
                  />
                  {name}
                </span>
                <span className="text-[#4a4a62] text-[13px]">buscando…</span>
              </div>
            ))}
          </div>
          {startBtn}
        </div>
      )}

      {settled && (
        <div className="flex flex-col gap-2.5 animate-fadeIn">
          <div className="bg-[#0a1f10] border-[1.5px] border-[#166534] rounded-[16px] px-[18px] py-4">
            <p className="text-[#4ade80] text-[13px] font-medium mb-1 flex items-center gap-1.5"><Check size={14} />Watchlists actualizadas</p>
            {lastUpdated && <p className="text-[#2d5a3d] text-[12px] mb-3">Última actualización: {lastUpdated}</p>}
            {entries.map(([name, r]) => (
              <div key={name} className="flex justify-between mb-1.5 last:mb-2.5">
                <span className="text-[#f8f8fa] text-[14px]">
                  <span
                    className="inline-block w-[7px] h-[7px] rounded-full mr-[7px] align-middle"
                    style={{ background: dotColor(name) }}
                  />
                  {name}
                </span>
                <span className={r.ok ? 'text-[#4ade80] text-[13px]' : 'text-[#fbbf24] text-[13px]'}>
                  {r.ok
                    ? `${r.count} películas ✓`
                    : `error — se mantuvo la lista${r.error ? ` (${r.error})` : ''}`}
                </span>
              </div>
            ))}
            {status.status === 'error' && status.result?.error && (
              <p className="text-[#fbbf24] text-[12px]">error — {status.result.error}</p>
            )}
            {reenriched && (
              <p className="text-[#2d5a3d] text-[12px]">Re-enriquecidas: {reenriched.enriched} películas</p>
            )}
          </div>
          {updateBtn}
          {startBtn}
        </div>
      )}
    </div>
  );
}
