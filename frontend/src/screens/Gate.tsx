// frontend/src/screens/Gate.tsx
import { useState } from 'react';
import { api } from '../api';
import { APP_NAME } from '../config';

export function Gate({ onOk }: { onOk: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  async function submit() {
    localStorage.setItem('passphrase', value);
    try {
      await api.get('/auth/check');
      onOk();
    } catch {
      localStorage.removeItem('passphrase');
      setError(true);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-3xl font-semibold">{APP_NAME}</h1>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Frase secreta"
        className="w-full max-w-xs rounded-lg bg-neutral-900 px-4 py-3 outline-none"
      />
      <button onClick={submit} className="rounded-lg bg-rose-600 px-6 py-3 font-medium">
        Entrar
      </button>
      {error && <p className="text-rose-400">Frase incorrecta</p>}
    </div>
  );
}
