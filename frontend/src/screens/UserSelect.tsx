// frontend/src/screens/UserSelect.tsx
import type { UserName } from '../types';
import { AVATAR } from '../assets/avatars';

export function UserSelect({ onPick }: { onPick: (u: UserName) => void }) {
  const users: UserName[] = ['Jo', 'Vale'];
  return (
    <div className="min-h-screen max-w-[430px] mx-auto flex flex-col items-center justify-center px-5 pb-12 animate-fadeUp">
      <p className="text-[10px] text-[#3a3a50] tracking-[0.15em] uppercase font-medium mb-2.5">
        TheCinematicUs
      </p>
      <div className="flex gap-3.5 w-full">
        {users.map((u) => (
          <button
            key={u}
            onClick={() => onPick(u)}
            className="flex-1 bg-[#111118] border-[1.5px] border-[#26263a] rounded-[24px] pt-[30px] pb-6 px-3 flex flex-col items-center gap-2.5"
          >
            <img src={AVATAR[u]} className="w-[58px] h-[58px] rounded-full object-cover" />
            <span className="font-display text-[22px] text-[#f8f8fa] font-bold">{u}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
