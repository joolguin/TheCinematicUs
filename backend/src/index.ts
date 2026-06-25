// backend/src/index.ts
import express from 'express';
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

const app = express();
app.use(cors());
app.use(express.json());
app.use(requirePassphrase);

// Verifica la passphrase sin efectos (para el gate del frontend).
app.get('/auth/check', (_req, res) => res.json({ ok: true }));

// Refresca el pozo en background. Responde 202 al toque; el estado real va a
// refresh_status (que el frontend lee por Realtime). El cron diario de Supabase
// pega a este mismo endpoint.
app.post('/watchlists/refresh', async (_req, res) => {
  try {
    const claimed = await claimRefresh();
    if (!claimed) {
      res.status(202).json({ status: 'running', already: true });
      return;
    }
    res.status(202).json({ status: 'running' });
    // Background, sin await. runRefreshJob escribe su propio estado; el .catch
    // es red de seguridad por si falla el propio write de error.
    runRefreshJob().catch((e) => console.error('[refresh job]', e));
  } catch (e: any) {
    console.error('[error endpoint]', e);
    res.status(500).json({ error: e.message });
  }
});

// Mazo pendiente: unión de las watchlists persistentes de TODAS las usuarias
// menos lo que esta usuaria ya swipeó en la sesión activa.
app.get('/deck', async (req, res) => {
  try {
    const { id: userId } = await getUserByName(String(req.query.user));
    const { id: sessionId, filters } = await getActiveSession();

    const { data: items } = await supabase
      .from('watchlist_items').select('movie_id, first_seen_at');
    // firstSeen por peli = máximo first_seen_at entre sus filas (recién agregada
    // por cualquiera de las dos = nueva). Las cadenas ISO comparan cronológicamente.
    const firstSeen = new Map<string, string>();
    for (const it of (items ?? []) as { movie_id: string; first_seen_at: string }[]) {
      const cur = firstSeen.get(it.movie_id);
      if (!cur || it.first_seen_at > cur) firstSeen.set(it.movie_id, it.first_seen_at);
    }
    const movieIds = [...firstSeen.keys()];

    const { data: swiped } = await supabase
      .from('swipes').select('movie_id').eq('session_id', sessionId).eq('user_id', userId);
    const swipedIds = new Set((swiped ?? []).map((s) => s.movie_id));

    const pending = movieIds.filter((id) => !swipedIds.has(id));
    const { data: movies } = await supabase.from('movies').select('*').in('id', pending);
    const pool = movies ?? [];
    // genres se calcula del pool pendiente SIN filtrar, para poblar los chips
    // aunque el filtro activo excluya algunos.
    const filtered = applyFilters(pool, filters);
    const states = await getMovieStates(userId, filtered.map((m) => m.id));
    res.json({ deck: orderByNovelty(filtered, states, firstSeen), genres: collectGenres(pool), filters });
  } catch (e: any) {
    console.error('[error endpoint]', e);
    res.status(500).json({ error: e.message });
  }
});

// Escribe el filtro de la noche en la sesión activa. Compartido: cualquiera lo
// edita; el Realtime de sessions propaga el cambio a la otra usuaria.
app.post('/session/filters', async (req, res) => {
  try {
    const { user, filters } = req.body as { user: string; filters: SessionFilters };
    const { id: sessionId } = await getActiveSession();
    const { error } = await supabase
      .from('sessions')
      .update({ filters, filters_updated_by: user })
      .eq('id', sessionId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[error endpoint]', e);
    res.status(500).json({ error: e.message });
  }
});

// Registra swipe y reporta si hubo match. Reconcilia como backstop de carrera.
app.post('/swipe', async (req, res) => {
  try {
    const { user, movieId, liked } = req.body as { user: string; movieId: string; liked: boolean };
    const { id: userId } = await getUserByName(user);
    const { id: sessionId } = await getActiveSession();
    const result = await recordSwipeAndDetectMatch(sessionId, userId, movieId, liked);
    try {
      await recordMovieState(userId, movieId, liked);
    } catch (e) {
      console.error('[recordMovieState]', e);
    }
    if (liked) await reconcileMatches(sessionId);
    res.json(result);
  } catch (e: any) {
    console.error('[error endpoint]', e);
    res.status(500).json({ error: e.message });
  }
});

// Deshace el último swipe (single-level): borra el swipe y, si rompe la
// mutualidad, el match. user_movie_state no se revierte (es solo pista de orden).
app.post('/swipe/undo', async (req, res) => {
  try {
    const { user, movieId } = req.body as { user: string; movieId: string };
    const { id: userId } = await getUserByName(user);
    const { id: sessionId } = await getActiveSession();
    await undoSwipe(sessionId, userId, movieId);
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[error endpoint]', e);
    res.status(500).json({ error: e.message });
  }
});

// Matches de la sesión activa, con datos de la peli. Reconcilia antes de leer (red de seguridad).
app.get('/matches', async (_req, res) => {
  try {
    const { id: sessionId } = await getActiveSession();
    await reconcileMatches(sessionId);
    const { data } = await supabase
      .from('matches').select('id, movies(*)').eq('session_id', sessionId)
      .order('created_at', { ascending: false });
    // sessionId: el frontend lo usa como baseline de la suscripción y para scopear los matches vistos.
    // matchId: identifica cada match; el resto son los campos de la película.
    res.json({ sessionId, matches: (data ?? []).map((m: any) => ({ matchId: m.id, ...m.movies })) });
  } catch (e: any) {
    console.error('[error endpoint]', e);
    res.status(500).json({ error: e.message });
  }
});

// Nueva sesión = nueva noche, mazo reseteado. Guarda quién la inició para el aviso en vivo.
app.post('/session', async (req, res) => {
  try {
    const { user } = req.body as { user?: string };
    const s = await createSession(user);
    res.json(s);
  } catch (e: any) {
    console.error('[error endpoint]', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(config.port, () => console.log(`backend en :${config.port}`));
