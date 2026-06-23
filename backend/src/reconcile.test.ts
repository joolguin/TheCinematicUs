// backend/src/reconcile.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let likes: any[];                 // filas de swipes likeados de la sesión
const upsertMatch = vi.fn();

vi.mock('./db.js', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'swipes') {
        // select('movie_id, user_id').eq('session_id', x).eq('liked', true)
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: likes }) }) }) };
      }
      // tabla matches: upsert idempotente
      return { upsert: (...a: any[]) => { upsertMatch(...a); return Promise.resolve({ error: null }); } };
    },
  },
}));

import { reconcileMatches } from './match.js';

beforeEach(() => { likes = []; upsertMatch.mockClear(); });

describe('reconcileMatches', () => {
  it('crea match cuando dos usuarias likearon la misma peli', async () => {
    likes = [
      { movie_id: 'm1', user_id: 'jo' },
      { movie_id: 'm1', user_id: 'vale' },
    ];
    await reconcileMatches('s');
    expect(upsertMatch).toHaveBeenCalledTimes(1);
    expect(upsertMatch).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: 's', movie_id: 'm1' }),
      expect.anything(),
    );
  });

  it('no crea match si sólo una likeó', async () => {
    likes = [{ movie_id: 'm1', user_id: 'jo' }];
    await reconcileMatches('s');
    expect(upsertMatch).not.toHaveBeenCalled();
  });

  it('no cuenta dos likes de la MISMA usuaria como match', async () => {
    likes = [
      { movie_id: 'm1', user_id: 'jo' },
      { movie_id: 'm1', user_id: 'jo' },
    ];
    await reconcileMatches('s');
    expect(upsertMatch).not.toHaveBeenCalled();
  });

  it('sólo reconcilia las pelis con match entre varias', async () => {
    likes = [
      { movie_id: 'm1', user_id: 'jo' },
      { movie_id: 'm1', user_id: 'vale' },  // match
      { movie_id: 'm2', user_id: 'jo' },    // sólo una
    ];
    await reconcileMatches('s');
    expect(upsertMatch).toHaveBeenCalledTimes(1);
    expect(upsertMatch).toHaveBeenCalledWith(
      expect.objectContaining({ movie_id: 'm1' }),
      expect.anything(),
    );
  });
});
