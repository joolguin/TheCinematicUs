import { describe, it, expect, vi } from 'vitest';

let usersRows: any[] = [];
vi.mock('./db.js', () => ({
  supabase: {
    from: () => ({ select: () => Promise.resolve({ data: usersRows, error: null }) }),
  },
}));

import { getUsers } from './users.js';

describe('getUsers', () => {
  it('devuelve id, name y letterboxd_url', async () => {
    usersRows = [{ id: 'u1', name: 'Jo', letterboxd_url: 'https://letterboxd.com/jo/watchlist/' }];
    const r = await getUsers();
    expect(r).toEqual([
      { id: 'u1', name: 'Jo', letterboxd_url: 'https://letterboxd.com/jo/watchlist/' },
    ]);
  });
});
