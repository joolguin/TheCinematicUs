import type { CSSProperties, ReactNode } from 'react';
import { Star } from 'lucide-react';
import type { Movie } from '../api';

function runtimeLabel(min: number | null): string {
  if (!min) return '';
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function posterStyle(movie: Movie): CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    backgroundImage: movie.poster_url ? `url(${movie.poster_url})` : 'none',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    backgroundColor: '#1a1a2e',
  };
}

export function MovieCard({ movie, expanded, onToggle }: {
  movie: Movie; expanded: boolean; onToggle: () => void;
}) {

  const meta: ReactNode[] = [];
  if (movie.year) meta.push(<span key="y" className="text-[#5a5a72] text-[15px]">({movie.year})</span>);
  if (movie.runtime) meta.push(<span key="r" className="text-[#5a5a72] text-[15px]">{runtimeLabel(movie.runtime)}</span>);
  if (movie.tmdb_rating != null)
    meta.push(
      <span key="rt" className="text-[#a78bfa] text-[15px] font-medium inline-flex items-center gap-1">
        <Star size={15} fill="currentColor" strokeWidth={0} /> {movie.tmdb_rating.toFixed(1)}
      </span>,
    );
  if (movie.country) meta.push(<span key="c" className="text-[#5a5a72] text-[14px]">{movie.country}</span>);

  const hasExtra = !!(movie.director || (movie.cast && movie.cast.length) || movie.overview);

  const gradient = expanded
    ? 'linear-gradient(to bottom,transparent 4%,rgba(9,9,14,.62) 28%,rgba(9,9,14,.97) 58%,rgba(9,9,14,1) 100%)'
    : 'linear-gradient(to bottom,transparent 24%,rgba(9,9,14,.2) 50%,rgba(9,9,14,.88) 74%,rgba(9,9,14,1) 100%)';

  return (
    <div
      onClick={onToggle}
      className="relative w-full h-full rounded-[20px] overflow-hidden cursor-pointer select-none"
    >
      <div style={posterStyle(movie)} />
      {!movie.poster_url && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <span className="text-[14px] text-[#5a5a72] tracking-[0.04em]">Sin póster</span>
        </div>
      )}
      <div className="absolute inset-0 pointer-events-none transition-[background] duration-300" style={{ background: gradient }} />

      <div className="absolute bottom-0 inset-x-0 px-4 pt-3.5 pb-4 pointer-events-none">
        <h3 className="font-display text-[22px] font-bold text-[#f8f8fa] mb-1 leading-[1.15] [text-shadow:0_2px_14px_rgba(0,0,0,.6)] [text-wrap:pretty]">
          {movie.title}
        </h3>
        {meta.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
            {meta.map((node, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-[#26263a] text-[13px]">·</span>}
                {node}
              </span>
            ))}
          </div>
        )}
        {movie.genres && movie.genres.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {movie.genres.map((g) => (
              <span
                key={g}
                className="bg-[rgba(124,58,237,.18)] border border-[rgba(124,58,237,.3)] rounded-[20px] px-[9px] py-[3px] text-[14px] text-[#c4b5fd] font-medium"
              >
                {g}
              </span>
            ))}
          </div>
        )}
        {expanded && (
          <div className="border-t border-[rgba(61,61,82,.3)] pt-[9px] mt-2 pointer-events-auto">
            {movie.director && (
              <p className="text-[15px] text-[#5a5a72] mb-0.5">
                Dir. <span className="text-[#c4c4d8]">{movie.director}</span>
              </p>
            )}
            {movie.cast && movie.cast.length > 0 && (
              <p className="text-[#3a3a50] text-[14px] mb-1.5 leading-[1.4]">{movie.cast.join(' · ')}</p>
            )}
            {movie.overview && (
              <p className="text-[#8888a0] text-[14px] leading-[1.55]">{movie.overview}</p>
            )}
            {!hasExtra && (
              <p className="text-[#3a3a50] text-[14px] italic">Sin información adicional disponible.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
