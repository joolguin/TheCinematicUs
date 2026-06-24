import { useState } from 'react';
import type { SessionFilters } from '../api';

const EMPTY: SessionFilters = { maxRuntime: null, excludeGenres: [] };

export function FilterBar({
  genres, filters, onChange,
}: { genres: string[]; filters: SessionFilters | null; onChange: (f: SessionFilters) => void }) {
  const [open, setOpen] = useState(false);
  const current = filters ?? EMPTY;
  const active = current.maxRuntime != null || current.excludeGenres.length > 0;

  function setMaxRuntime(v: number | null) {
    onChange({ ...current, maxRuntime: v });
  }
  function toggleGenre(g: string) {
    const has = current.excludeGenres.includes(g);
    onChange({
      ...current,
      excludeGenres: has ? current.excludeGenres.filter((x) => x !== g) : [...current.excludeGenres, g],
    });
  }

  return (
    <div className="mb-2 text-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`rounded-lg px-3 py-1.5 ${active ? 'bg-rose-600' : 'bg-neutral-800'}`}
      >
        ☰ Filtros{active ? ' •' : ''}
      </button>
      {open && (
        <div className="mt-2 rounded-lg bg-neutral-900 p-3 flex flex-col gap-3">
          <label className="flex items-center gap-2">
            <span className="w-24 text-neutral-400">Duración máx</span>
            <input
              type="range" min={60} max={240} step={15}
              value={current.maxRuntime ?? 240}
              onChange={(e) => setMaxRuntime(Number(e.target.value))}
              className="flex-1"
            />
            <span className="w-20 text-right">
              {current.maxRuntime == null ? 'sin límite' : `${current.maxRuntime} min`}
            </span>
            {current.maxRuntime != null && (
              <button onClick={() => setMaxRuntime(null)} className="text-neutral-400 underline">
                quitar
              </button>
            )}
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-neutral-400">Excluir géneros</span>
            <div className="flex flex-wrap gap-1.5">
              {genres.map((g) => {
                const excluded = current.excludeGenres.includes(g);
                return (
                  <button
                    key={g}
                    onClick={() => toggleGenre(g)}
                    className={`rounded-full px-2.5 py-1 ${excluded ? 'bg-rose-600 line-through' : 'bg-neutral-800'}`}
                  >
                    {g}
                  </button>
                );
              })}
              {genres.length === 0 && <span className="text-neutral-600">sin géneros en el mazo</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
