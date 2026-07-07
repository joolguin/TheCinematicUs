import { useState } from 'react';
import { api } from '../api';
import { APP_NAME } from '../config';
import { STORAGE_KEYS } from '../constants';

export function Gate({ onOk }: { onOk: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  async function submit() {
    localStorage.setItem(STORAGE_KEYS.passphrase, value);
    try {
      await api.get('/auth/check');
      onOk();
    } catch {
      localStorage.removeItem(STORAGE_KEYS.passphrase);
      setError(true);
    }
  }

  return (
    <div className="min-h-screen max-w-[430px] mx-auto flex flex-col items-center justify-center px-7 pb-12 animate-fadeUp">
      <div className="text-center mb-12">
        <h1 className="font-display text-[32px] font-bold text-screen tracking-[-0.5px] leading-tight">
          {APP_NAME}
        </h1>
      </div>

      <div className="w-full flex flex-col gap-2.5">
        <input
          type="password"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Frase secreta…"
          className="w-full bg-ink border border-whisper rounded-[14px] px-[18px] py-[15px] text-[18px] text-screen outline-none focus:border-ember focus:ring-1 focus:ring-ember"
        />
        <button
          onClick={submit}
          className="bg-ember text-theater rounded-[14px] py-4 text-[18px] font-semibold"
        >
          Entrar
        </button>
        {error && (
          <p className="text-error text-[16px] text-center mt-0.5">
            Frase incorrecta — intentá de nuevo
          </p>
        )}
      </div>
    </div>
  );
}
