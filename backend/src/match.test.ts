import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();

vi.mock('./db.js', () => ({
  supabase: {
    rpc: (...args: any[]) => rpcMock(...args),
  },
}));

import { recordSwipeAndDetectMatch } from './match.js';

beforeEach(() => { rpcMock.mockReset(); });

describe('recordSwipeAndDetectMatch', () => {
  it('llama al RPC con los parámetros del swipe', async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    await recordSwipeAndDetectMatch('s', 'u1', 'm', true);
    expect(rpcMock).toHaveBeenCalledWith('record_swipe_and_detect_match', {
      p_session_id: 's',
      p_user_id: 'u1',
      p_movie_id: 'm',
      p_liked: true,
    });
  });

  it('devuelve matched=true cuando el RPC detecta mutualidad', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    const result = await recordSwipeAndDetectMatch('s', 'u1', 'm', true);
    expect(result.matched).toBe(true);
  });

  it('devuelve matched=false cuando el RPC no detecta mutualidad', async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    const result = await recordSwipeAndDetectMatch('s', 'u1', 'm', false);
    expect(result.matched).toBe(false);
  });

  it('propaga el error del RPC', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error('rpc caída') });
    await expect(recordSwipeAndDetectMatch('s', 'u1', 'm', true)).rejects.toThrow('rpc caída');
  });
});
