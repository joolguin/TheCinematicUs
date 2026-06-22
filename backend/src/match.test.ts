// backend/src/match.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsertMock = vi.fn();
const insertMock = vi.fn();
const othersResult = vi.fn();

vi.mock('./db.js', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'swipes') {
        return {
          upsert: (...a: any[]) => { upsertMock(...a); return Promise.resolve({ error: null }); },
          // cadena select().eq().eq().eq().neq()
          select: () => ({
            eq: () => ({ eq: () => ({ eq: () => ({ neq: () => Promise.resolve(othersResult()) }) }) }),
          }),
        };
      }
      // tabla matches
      return {
        insert: (...a: any[]) => { insertMock(...a); return Promise.resolve({ error: null }); },
      };
    },
  },
}));

import { recordSwipeAndDetectMatch } from './match.js';

beforeEach(() => { upsertMock.mockClear(); insertMock.mockClear(); othersResult.mockReset(); });

describe('recordSwipeAndDetectMatch', () => {
  it('NO matchea si la otra no likeó', async () => {
    othersResult.mockReturnValue({ data: [] });
    const r = await recordSwipeAndDetectMatch('s', 'u1', 'm', true);
    expect(r.matched).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('matchea si la otra ya likeó', async () => {
    othersResult.mockReturnValue({ data: [{ id: 'x' }] });
    const r = await recordSwipeAndDetectMatch('s', 'u1', 'm', true);
    expect(r.matched).toBe(true);
    expect(insertMock).toHaveBeenCalled();
  });

  it('un pass nunca matchea', async () => {
    const r = await recordSwipeAndDetectMatch('s', 'u1', 'm', false);
    expect(r.matched).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
