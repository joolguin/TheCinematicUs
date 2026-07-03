import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { requirePassphrase } from './middleware/auth.js';
import { supabase } from './db.js';
import { getActiveSession, createSession, invalidateActiveSessionCache } from './sessions.js';
import { recordSwipeAndDetectMatch, reconcileMatches, undoSwipe } from './match.js';
import { getUserByName } from './users.js';
import { claimRefresh, runRefreshJob } from './refreshJob.js';
import { applyFilters, collectGenres, type SessionFilters } from './filters.js';
import { recordMovieState, getMovieStates, orderByNovelty } from './userMovieState.js';
import { TABLES } from './constants.js';

const HTTP_ACCEPTED = 202;
const HTTP_INTERNAL_ERROR = 500;

const app = express();
app.use(cors());
app.use(express.json());
app.use(requirePassphrase);

type RouteHandler = (req: Request, res: Response) => Promise<void>;

function asyncRoute(handler: RouteHandler) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error('[error endpoint]', error);
      const message = error instanceof Error ? error.message : 'error inesperado';
      res.status(HTTP_INTERNAL_ERROR).json({ error: message });
    }
  };
}

app.get('/auth/check', (_req, res) => res.json({ ok: true }));

app.post('/watchlists/refresh', asyncRoute(async (_req, res) => {
  const claimed = await claimRefresh();
  if (!claimed) {
    res.status(HTTP_ACCEPTED).json({ status: 'running', already: true });
    return;
  }
  res.status(HTTP_ACCEPTED).json({ status: 'running' });
  runRefreshJob().catch((error) => console.error('[refresh job]', error));
}));

app.get('/deck', asyncRoute(async (req, res) => {
  const { id: userId } = await getUserByName(String(req.query.user));
  const { id: sessionId, filters } = await getActiveSession();

  const { data: items } = await supabase
    .from(TABLES.watchlistItems).select('movie_id, first_seen_at');
  const firstSeen = new Map<string, string>();
  for (const item of (items ?? []) as { movie_id: string; first_seen_at: string }[]) {
    const current = firstSeen.get(item.movie_id);
    if (!current || item.first_seen_at > current) firstSeen.set(item.movie_id, item.first_seen_at);
  }
  const movieIds = [...firstSeen.keys()];

  const { data: swiped } = await supabase
    .from(TABLES.swipes).select('movie_id').eq('session_id', sessionId).eq('user_id', userId);
  const swipedIds = new Set((swiped ?? []).map((swipe) => swipe.movie_id));

  const pending = movieIds.filter((id) => !swipedIds.has(id));
  const { data: movies } = await supabase.from(TABLES.movies).select('*').in('id', pending);
  const pool = movies ?? [];
  const filtered = applyFilters(pool, filters);
  const states = await getMovieStates(userId, filtered.map((movie) => movie.id));
  res.json({ deck: orderByNovelty(filtered, states, firstSeen), genres: collectGenres(pool), filters });
}));

app.post('/session/filters', asyncRoute(async (req, res) => {
  const { user, filters } = req.body as { user: string; filters: SessionFilters };
  const { id: sessionId } = await getActiveSession();
  const { error } = await supabase
    .from(TABLES.sessions)
    .update({ filters, filters_updated_by: user })
    .eq('id', sessionId);
  if (error) throw error;
  invalidateActiveSessionCache();
  res.json({ ok: true });
}));

app.post('/swipe', asyncRoute(async (req, res) => {
  const { user, movieId, liked } = req.body as { user: string; movieId: string; liked: boolean };
  const { id: userId } = await getUserByName(user);
  const { id: sessionId } = await getActiveSession();
  const result = await recordSwipeAndDetectMatch(sessionId, userId, movieId, liked);
  res.json(result);
  recordMovieState(userId, movieId, liked)
    .catch((error) => console.error('[recordMovieState]', error));
  if (liked) {
    reconcileMatches(sessionId)
      .catch((error) => console.error('[reconcileMatches]', error));
  }
}));

app.post('/swipe/undo', asyncRoute(async (req, res) => {
  const { user, movieId } = req.body as { user: string; movieId: string };
  const { id: userId } = await getUserByName(user);
  const { id: sessionId } = await getActiveSession();
  await undoSwipe(sessionId, userId, movieId);
  res.json({ ok: true });
}));

app.get('/matches', asyncRoute(async (_req, res) => {
  const { id: sessionId } = await getActiveSession();
  await reconcileMatches(sessionId);
  const { data } = await supabase
    .from(TABLES.matches).select('id, movies(*)').eq('session_id', sessionId)
    .order('created_at', { ascending: false });
  res.json({ sessionId, matches: (data ?? []).map((match: any) => ({ matchId: match.id, ...match.movies })) });
}));

app.post('/session', asyncRoute(async (req, res) => {
  const { user } = req.body as { user?: string };
  const session = await createSession(user);
  res.json(session);
}));

app.listen(config.port, () => console.log(`backend en :${config.port}`));
