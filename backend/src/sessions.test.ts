import { describe, it, expect, vi, beforeEach } from 'vitest';

let activeRow: any;
let activeReads: any[] | null;
let insertResult: any;
const updateMock = vi.fn();
const insertMock = vi.fn();

function readActive() {
  if (activeReads && activeReads.length) return { data: activeReads.shift() };
  return { data: activeRow };
}

vi.mock('./db.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve(readActive()) }) }) }),
      }),
      update: (...a: any[]) => { updateMock(...a); return { eq: () => Promise.resolve({ error: null }) }; },
      insert: (...a: any[]) => { insertMock(...a); return { select: () => ({ single: () => Promise.resolve(insertResult) }) }; },
    }),
  },
}));

import { getActiveSession, createSession } from './sessions.js';

beforeEach(() => {
  activeRow = null;
  activeReads = null;
  insertResult = { data: { id: 'nueva' }, error: null };
  updateMock.mockClear();
  insertMock.mockClear();
});

describe('getActiveSession', () => {
  it('devuelve la sesión activa si existe', async () => {
    activeRow = { id: 's1', filters: null };
    expect(await getActiveSession()).toEqual({ id: 's1', filters: null });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('crea una sesión si no hay activa', async () => {
    activeRow = null;
    insertResult = { data: { id: 's2' }, error: null };
    expect(await getActiveSession()).toEqual({ id: 's2', filters: null });
    expect(insertMock).toHaveBeenCalled();
  });
});

describe('createSession', () => {
  it('desactiva las activas y devuelve la nueva', async () => {
    insertResult = { data: { id: 's3' }, error: null };
    expect(await createSession()).toEqual({ id: 's3' });
    expect(updateMock).toHaveBeenCalledWith({ active: false, ended_at: expect.any(String) });
  });

  it('guarda started_by', async () => {
    insertResult = { data: { id: 's4' }, error: null };
    await createSession('Vale');
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ started_by: 'Vale' }));
  });

  it('ante carrera (23505) re-lee la sesión activa ganadora', async () => {
    insertResult = { data: null, error: { code: '23505', message: 'duplicate' } };
    activeRow = { id: 'ganadora' };
    expect(await createSession()).toEqual({ id: 'ganadora' });
  });

  it('reintenta la lectura si la ganadora no es visible al primer intento', async () => {
    insertResult = { data: null, error: { code: '23505', message: 'duplicate' } };
    activeReads = [null, { id: 'ganadora' }];
    expect(await createSession()).toEqual({ id: 'ganadora' });
  });

  it('lanza si tras reintentar no hay sesión activa', async () => {
    insertResult = { data: null, error: { code: '23505', message: 'duplicate' } };
    activeReads = [null, null];
    await expect(createSession()).rejects.toMatchObject({ code: '23505' });
  });
});
