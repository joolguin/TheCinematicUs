import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const suite = url && anonKey ? describe : describe.skip;

suite('privacidad: la anon key NO puede leer likes', () => {

  let anon: ReturnType<typeof createClient>;
  beforeAll(() => {
    anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
  });

  it('no lee swipes', async () => {
    const { data } = await anon.from('swipes').select('*').limit(1);
    expect(data ?? []).toHaveLength(0);
  });

  it('no lee watchlist_items', async () => {
    const { data } = await anon.from('watchlist_items').select('*').limit(1);
    expect(data ?? []).toHaveLength(0);
  });

  it('no lee user_movie_state', async () => {
    const { data } = await anon.from('user_movie_state').select('*').limit(1);
    expect(data ?? []).toHaveLength(0);
  });
});
