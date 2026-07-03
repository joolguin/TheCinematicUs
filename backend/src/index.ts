// backend/src/index.ts
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { requirePassphrase } from './middleware/auth.js';
import { supabase } from './db.js';
import { getActiveSession, createSession } from './sessions.js';
import { recordSwipeAndDetectMatch, reconcileMatches, undoSwipe } from './match.js';
import { getUserByName } from './users.js';
import { claimRefresh, runRefreshJob } from './refreshJob.js';
import { applyFilters, collectGenres, type SessionFilters } from './filters.js';
import { recordMovieState, getMovieStates, orderByNovelty } from './userMovieState.js';

const HTTP_ACCEPTED = 202;
const HTTP_INTERNAL_ERROR = 500;

const app = express();
app.use(cors());
app.use(express.json());
app.use(requirePassphrase);

type RouteHandler = (req: Request, res: Response) => Promise<void>;

// Centraliza el manejo de errores de los handlers async: cualquier throw se loguea
// y responde 500 con el mensaje, en un solo lugar (en vez de repetir try/catch en cada ruta).
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

// Verifica la passphrase sin efectos (para el gate del frontend).
app.get('/auth/check', (_req, res) => res.json({ ok: true }));

// Refresca el pozo en background. Responde 202 al toque; el estado real va a
// refresh_status (que el frontend lee por Realtime). El cron diario de Supabase
// pega a este mismo endpoint.
app.post('/watchlists/refresh', asyncRoute(async (_req, res) => {
  const claimed = await claimRefresh();
  if (!claimed) {
    res.status(HTTP_ACCEPTED).json({ status: 'running', already: true });
    return;
  }
  res.status(HTTP_ACCEPTED).json({ status: 'running' });
  // Background, sin await. runRefreshJob escribe su propio estado; el .catch
  // es red de seguridad por si falla el propio write de error.
  runRefreshJob().catch((error) => console.error('[refresh job]', error));
}));

// Mazo pendiente: unión de las watchlists persistentes de TODAS las usuarias
// menos lo que esta usuaria ya swipeó en la sesión activa.
app.get('/deck', asyncRoute(async (req, res) => {
  const { id: userId } = await getUserByName(String(req.query.user));
  const { id: sessionId, filters } = await getActiveSession();

  const { data: items } = await supabase
    .from('watchlist_items').select('movie_id, first_seen_at');
  // firstSeen por peli = máximo first_seen_at entre sus filas (recién agregada
  // por cualquiera de las dos = nueva). Las cadenas ISO comparan cronológicamente.
  const firstSeen = new Map<string, string>();
  for (const item of (items ?? []) as { movie_id: string; first_seen_at: string }[]) {
    const current = firstSeen.get(item.movie_id);
    if (!current || item.first_seen_at > current) firstSeen.set(item.movie_id, item.first_seen_at);
  }
  const movieIds = [...firstSeen.keys()];

  const { data: swiped } = await supabase
    .from('swipes').select('movie_id').eq('session_id', sessionId).eq('user_id', userId);
  const swipedIds = new Set((swiped ?? []).map((swipe) => swipe.movie_id));

  const pending = movieIds.filter((id) => !swipedIds.has(id));
  const { data: movies } = await supabase.from('movies').select('*').in('id', pending);
  const pool = movies ?? [];
  // genres se calcula del pool pendiente SIN filtrar, para poblar los chips
  // aunque el filtro activo excluya algunos.
  const filtered = applyFilters(pool, filters);
  const states = await getMovieStates(userId, filtered.map((movie) => movie.id));
  res.json({ deck: orderByNovelty(filtered, states, firstSeen), genres: collectGenres(pool), filters });
}));

// Escribe el filtro de la noche en la sesión activa. Compartido: cualquiera lo
// edita; el Realtime de sessions propaga el cambio a la otra usuaria.
app.post('/session/filters', asyncRoute(async (req, res) => {
  const { user, filters } = req.body as { user: string; filters: SessionFilters };
  const { id: sessionId } = await getActiveSession();
  const { error } = await supabase
    .from('sessions')
    .update({ filters, filters_updated_by: user })
    .eq('id', sessionId);
  if (error) throw error;
  res.json({ ok: true });
}));

// Registra swipe y reporta si hubo match. Reconcilia como backstop de carrera.
app.post('/swipe', asyncRoute(async (req, res) => {
  const { user, movieId, liked } = req.body as { user: string; movieId: string; liked: boolean };
  const { id: userId } = await getUserByName(user);
  const { id: sessionId } = await getActiveSession();
  const result = await recordSwipeAndDetectMatch(sessionId, userId, movieId, liked);
  try {
    await recordMovieState(userId, movieId, liked);
  } catch (error) {
    console.error('[recordMovieState]', error);
  }
  if (liked) await reconcileMatches(sessionId);
  res.json(result);
}));

// Deshace el último swipe (single-level): borra el swipe y, si rompe la
// mutualidad, el match. user_movie_state no se revierte (es solo pista de orden).
app.post('/swipe/undo', asyncRoute(async (req, res) => {
  const { user, movieId } = req.body as { user: string; movieId: string };
  const { id: userId } = await getUserByName(user);
  const { id: sessionId } = await getActiveSession();
  await undoSwipe(sessionId, userId, movieId);
  res.json({ ok: true });
}));

// Matches de la sesión activa, con datos de la peli. Reconcilia antes de leer (red de seguridad).
app.get('/matches', asyncRoute(async (_req, res) => {
  const { id: sessionId } = await getActiveSession();
  await reconcileMatches(sessionId);
  const { data } = await supabase
    .from('matches').select('id, movies(*)').eq('session_id', sessionId)
    .order('created_at', { ascending: false });
  // sessionId: el frontend lo usa como baseline de la suscripción y para scopear los matches vistos.
  // matchId: identifica cada match; el resto son los campos de la película.
  res.json({ sessionId, matches: (data ?? []).map((match: any) => ({ matchId: match.id, ...match.movies })) });
}));

// Nueva sesión = nueva noche, mazo reseteado. Guarda quién la inició para el aviso en vivo.
app.post('/session', asyncRoute(async (req, res) => {
  const { user } = req.body as { user?: string };
  const session = await createSession(user);
  res.json(session);
}));

app.listen(config.port, () => console.log(`backend en :${config.port}`));
