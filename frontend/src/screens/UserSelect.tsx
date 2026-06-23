// frontend/src/screens/UserSelect.tsx
import { INITIALS, type UserName } from '../types';

export function UserSelect({ onPick }: { onPick: (u: UserName) => void }) {
  const users: UserName[] = ['Jo', 'Vale'];
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
      <h2 className="text-xl text-neutral-400">¿Quién sos?</h2>
      <div className="flex gap-4">
        {users.map((u) => (
          <button
            key={u}
            onClick={() => onPick(u)}
            className="flex flex-col items-center gap-2 rounded-2xl bg-neutral-900 px-8 py-6 text-lg"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-800 text-2xl font-semibold text-neutral-300">{INITIALS[u]}</span>
            {u}
          </button>
        ))}
      </div>
    </div>
  );
}
