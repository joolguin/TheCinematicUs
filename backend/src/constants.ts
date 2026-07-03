export const TABLES = {
  users: 'users',
  sessions: 'sessions',
  swipes: 'swipes',
  matches: 'matches',
  movies: 'movies',
  watchlistItems: 'watchlist_items',
  userMovieState: 'user_movie_state',
  refreshStatus: 'refresh_status',
} as const;

export const REFRESH_JOB_STATUS = {
  idle: 'idle',
  running: 'running',
  done: 'done',
  error: 'error',
} as const;

export const REFRESH_STATUS_ROW_ID = 1;

export const SESSION_MODE = {
  pool: 'pool',
} as const;

export const DECK_MOVIE_COLUMNS =
  'id, title, year, poster_url, director, cast, runtime, genres, overview, tmdb_rating, country';

export const RPC = {
  recordSwipeAndDetectMatch: 'record_swipe_and_detect_match',
} as const;

export const POSTGRES_ERROR_CODE = {
  uniqueViolation: '23505',
} as const;
