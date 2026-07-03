import { describe, it, expect, vi } from 'vitest';
import { requirePassphrase } from './auth.js';

vi.mock('../config.js', () => ({ config: { appPassphrase: 'secreta' } }));

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('requirePassphrase', () => {
  it('deja pasar con la passphrase correcta', () => {
    const next = vi.fn();
    requirePassphrase({ headers: { 'x-passphrase': 'secreta' } } as any, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('responde 401 con passphrase incorrecta', () => {
    const next = vi.fn();
    const res = mockRes();
    requirePassphrase({ headers: { 'x-passphrase': 'mala' } } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
