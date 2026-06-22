// frontend/src/components/MovieCard.tsx
import type { Movie } from '../api';

function runtimeLabel(min: number | null): string {
  if (!min) return '';
  return `${Math.floor(min / 60)}h ${min % 60}min`;
}

export function MovieCard({ movie, expanded, onToggle }: {
  movie: Movie; expanded: boolean; onToggle: () => void;
}) {
  return (
    <div onClick={onToggle} className="w-full h-full rounded-2xl overflow-hidden bg-neutral-900 flex flex-col cursor-pointer select-none">
      <div className="h-[60%] bg-neutral-800 flex items-center justify-center">
        {movie.poster_url
          ? <img src={movie.poster_url} alt={movie.title} className="h-full w-full object-cover" draggable={false} />
          : <span className="text-neutral-600 text-sm px-4 text-center">Sin poster — {movie.title}</span>}
      </div>
      <div className="p-4 flex-1 overflow-y-auto">
        <h3 className="text-lg font-semibold">{movie.title} {movie.year && <span className="text-neutral-500">({movie.year})</span>}</h3>
        <div className="flex flex-wrap gap-2 items-center text-sm text-neutral-400 mt-1">
          {movie.runtime && <span>{runtimeLabel(movie.runtime)}</span>}
          {movie.tmdb_rating != null && <span>⭐ {movie.tmdb_rating.toFixed(1)}</span>}
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {(movie.genres ?? []).map((g) => (
            <span key={g} className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs">{g}</span>
          ))}
        </div>
        {expanded && (
          <div className="mt-3 text-sm text-neutral-300 space-y-2">
            {movie.director && <p><span className="text-neutral-500">Dirección:</span> {movie.director}</p>}
            {movie.cast && <p><span className="text-neutral-500">Reparto:</span> {movie.cast.join(', ')}</p>}
            {movie.overview && <p>{movie.overview}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
