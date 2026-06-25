import { describe, it, expect, vi, beforeEach } from 'vitest';

let likers: { user_id: string }[];
const swipeDeleteMock = vi.fn();
const matchDeleteMock = vi.fn();

vi.mock('./db.js', () => {
  // chain encadenable y awaitable: .eq() devuelve el mismo objeto; await → resolved.
  const eqChain = (resolved: any) => {
    const obj: any = { eq: () => obj, then: (r: any) => Promise.resolve(resolved).then(r) };
    return obj;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === 'swipes') {
          return {
            delete: () => { swipeDeleteMock(); return eqChain({ error: null }); },
            select: () => eqChain({ data: likers }),
          };
        }
        // matches
        return { delete: () => { matchDeleteMock(); return eqChain({ error: null }); } };
      },
    },
  };
});

import { undoSwipe } from './match.js';

beforeEach(() => {
  likers = [];
  swipeDeleteMock.mockClear();
  matchDeleteMock.mockClear();
});

describe('undoSwipe', () => {
  it('borra el swipe de la usuaria para esa peli', async () => {
    likers = [];
    await undoSwipe('s', 'jo', 'm1');
    expect(swipeDeleteMock).toHaveBeenCalledTimes(1);
  });

  it('borra el match si quedan menos de 2 likers distintos', async () => {
    likers = [{ user_id: 'vale' }]; // tras deshacer el like de Jo, solo queda Vale
    await undoSwipe('s', 'jo', 'm1');
    expect(matchDeleteMock).toHaveBeenCalledTimes(1);
  });

  it('no borra el match si siguen 2 likers distintos', async () => {
    likers = [{ user_id: 'vale' }, { user_id: 'otra' }];
    await undoSwipe('s', 'jo', 'm1');
    expect(matchDeleteMock).not.toHaveBeenCalled();
  });
});
