import type { SessionFilters } from '../api';

const EMPTY: SessionFilters = { maxRuntime: null, excludeGenres: [] };

// Panel de filtros como bottom-sheet controlado desde Swipe (el botón ☰ vive en
// el header). Se muestra sólo cuando `open` es true.
export function FilterBar({
  genres, filters, open, onChange, onClose,
}: {
  genres: string[];
  filters: SessionFilters | null;
  open: boolean;
  onChange: (f: SessionFilters) => void;
  onClose: () => void;
}) {
  const current = filters ?? EMPTY;

  function setMaxRuntime(v: number) {
    onChange({ ...current, maxRuntime: v >= 240 ? null : v });
  }
  function toggleGenre(g: string) {
    const has = current.excludeGenres.includes(g);
    onChange({
      ...current,
      excludeGenres: has ? current.excludeGenres.filter((x) => x !== g) : [...current.excludeGenres, g],
    });
  }

  if (!open) return null;

  const value = current.maxRuntime ?? 240;
  const label = value >= 240 ? 'Sin límite' : `${value} min`;

  return (
    <>
      <div onClick={onClose} className="absolute inset-0 bg-[rgba(9,9,14,.7)] z-[65]" />
      <div className="absolute bottom-0 inset-x-0 bg-[#111118] rounded-t-[22px] border-t border-[#1e1e2a] px-[18px] pt-[18px] pb-7 z-[70] animate-slideUp">
        <div className="flex justify-between items-center mb-[18px]">
          <h3 className="font-display text-[17px] text-[#f8f8fa] font-bold">Filtros</h3>
          <button onClick={onClose} className="text-[#4a4a62] text-[16px] px-1.5 py-1">Cerrar</button>
        </div>

        <div className="mb-5">
          <div className="flex justify-between items-center mb-[11px]">
            <span className="text-[16px] text-[#8888a0] font-medium">Duración máxima</span>
            <span className="text-[16px] text-[#a78bfa] font-semibold">{label}</span>
          </div>
          <input
            type="range"
            min={60}
            max={240}
            step={15}
            value={value}
            onChange={(e) => setMaxRuntime(Number(e.target.value))}
          />
        </div>

        <div>
          <p className="text-[16px] text-[#8888a0] font-medium mb-2.5">Géneros a excluir</p>
          <div className="flex flex-wrap gap-[7px]">
            {genres.map((g) => {
              const ex = current.excludeGenres.includes(g);
              return (
                <button
                  key={g}
                  onClick={() => toggleGenre(g)}
                  className="rounded-[20px] px-3.5 py-[7px] text-[16px] transition-all"
                  style={{
                    background: ex ? 'rgba(30,30,42,.5)' : 'rgba(124,58,237,.15)',
                    border: `1px solid ${ex ? '#26263a' : 'rgba(124,58,237,.38)'}`,
                    color: ex ? '#3a3a50' : '#c4b5fd',
                  }}
                >
                  {g}
                </button>
              );
            })}
            {genres.length === 0 && (
              <span className="text-[#3a3a50] text-[16px]">Sin géneros en el mazo</span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
