// backend/src/index.ts
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { requirePassphrase } from './middleware/auth.js';
import { supabase } from './db.js';
import { parseTitleLine } from './tmdb.js';
import { resolveMovie } from './movies.js';
import { getActiveSession, createSession } from './sessions.js';
import { recordSwipeAndDetectMatch, reconcileMatches } from './match.js';
import { getUserByName } from './users.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(requirePassphrase);

// Verifica la passphrase sin efectos (para el gate del frontend).
app.get('/auth/check', (_req, res) => res.json({ ok: true }));

// Importa títulos pegados a mano por una usuaria.
app.post('/import', async (req, res) => {
  try {
    const { user, titles } = req.body as { user: string; titles: string };
    const { id: userId } = await getUserByName(user);
    const { id: sessionId } = await getActiveSession();
    const lines = titles.split('\n').map(parseTitleLine).filter((l) => l.title);

    let imported = 0;
    let minimal = 0;
    for (const { title, year } of lines) {
      const { id: movieId } = await resolveMovie(title, year);
      const { data: movie } = await supabase
        .from('movies').select('enriched').eq('id', movieId).single();
      if (!movie?.enriched) minimal++;
      await supabase.from('watchlist_items').upsert(
        { session_id: sessionId, user_id: userId, movie_id: movieId },
        { onConflict: 'session_id,user_id,movie_id' },
      );
      imported++;
    }
    res.json({ imported, minimal });
  } catch (e: any) {
    console.error('[error endpoint]', e);
    res.status(500).json({ error: e.message });
  }
});

// Mazo pendiente: unión de watchlists de la sesión menos lo que esta usuaria ya swipeó.
app.get('/deck', async (req, res) => {
  try {
    const { id: userId } = await getUserByName(String(req.query.user));
    const { id: sessionId } = await getActiveSession();

    const { data: items } = await supabase
      .from('watchlist_items').select('movie_id').eq('session_id', sessionId);
    const movieIds = [...new Set((items ?? []).map((i) => i.movie_id))];

    const { data: swiped } = await supabase
      .from('swipes').select('movie_id').eq('session_id', sessionId).eq('user_id', userId);
    const swipedIds = new Set((swiped ?? []).map((s) => s.movie_id));

    const pending = movieIds.filter((id) => !swipedIds.has(id));
    const { data: movies } = await supabase.from('movies').select('*').in('id', pending);
    res.json({ deck: movies ?? [] });
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
    if (liked) await reconcileMatches(sessionId);
    res.json(result);
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
