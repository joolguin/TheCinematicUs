// frontend/src/App.tsx
import { useState } from 'react';
import './index.css';
import { Gate } from './screens/Gate';
import { UserSelect } from './screens/UserSelect';
import { Import } from './screens/Import';
import { Swipe } from './screens/Swipe';
import type { UserName } from './types';

type Screen = 'gate' | 'user' | 'import' | 'swipe';

export default function App() {
  const [screen, setScreen] = useState<Screen>(
    localStorage.getItem('passphrase') ? 'user' : 'gate',
  );
  const [user, setUser] = useState<UserName | null>(null);

  if (screen === 'gate') return <Gate onOk={() => setScreen('user')} />;
  if (screen === 'user') return <UserSelect onPick={(u) => { setUser(u); setScreen('import'); }} />;
  if (screen === 'import' && user) return <Import user={user} onDone={() => setScreen('swipe')} />;
  if (screen === 'swipe' && user) return <Swipe user={user} />;
  return null;
}
