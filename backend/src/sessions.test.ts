// backend/src/sessions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let activeRow: any;       // lo que devuelve la lectura de la sesión activa
let insertResult: any;    // { data, error } que devuelve el insert
const updateMock = vi.fn();
const insertMock = vi.fn();

vi.mock('./db.js', () => ({
  supabase: {
    from: () => ({
      // select('id').eq('active', true).order().limit().maybeSingle()
      select: () => ({
        eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: activeRow }) }) }) }),
      }),
      // update({ active: false }).eq('active', true)
      update: (...a: any[]) => { updateMock(...a); return { eq: () => Promise.resolve({ error: null }) }; },
      // insert({...}).select('id').single()
      insert: (...a: any[]) => { insertMock(...a); return { select: () => ({ single: () => Promise.resolve(insertResult) }) }; },
    }),
  },
}));

import { getActiveSession, createSession } from './sessions.js';

beforeEach(() => {
  activeRow = null;
  insertResult = { data: { id: 'nueva' }, error: null };
  updateMock.mockClear();
  insertMock.mockClear();
});

describe('getActiveSession', () => {
  it('devuelve la sesión activa si existe', async () => {
    activeRow = { id: 's1' };
    expect(await getActiveSession()).toEqual({ id: 's1' });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('crea una sesión si no hay activa', async () => {
    activeRow = null;
    insertResult = { data: { id: 's2' }, error: null };
    expect(await getActiveSession()).toEqual({ id: 's2' });
    expect(insertMock).toHaveBeenCalled();
  });
});

describe('createSession', () => {
  it('desactiva las activas y devuelve la nueva', async () => {
    insertResult = { data: { id: 's3' }, error: null };
    expect(await createSession()).toEqual({ id: 's3' });
    expect(updateMock).toHaveBeenCalledWith({ active: false });
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
});
