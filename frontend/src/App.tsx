// frontend/src/App.tsx
import { useState } from 'react';
import './index.css';
import { Gate } from './screens/Gate';
import { UserSelect } from './screens/UserSelect';
import { Import } from './screens/Import';
import { Swipe } from './screens/Swipe';
import type { UserName } from './types';

type Screen = 'gate' | 'user' | 'import' | 'swipe';

function storedUser(): UserName | null {
  const u = localStorage.getItem('user');
  return u === 'Jo' || u === 'Vale' ? u : null;
}

function initialScreen(): Screen {
  if (!localStorage.getItem('passphrase')) return 'gate';
  return storedUser() ? 'swipe' : 'user';
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [user, setUser] = useState<UserName | null>(storedUser);

  // Elegir usuaria: se recuerda para próximas recargas.
  function pick(u: UserName) {
    localStorage.setItem('user', u);
    setUser(u);
    setScreen('import');
  }

  // Cambiar usuaria: olvida la elección y vuelve a seleccionar (pasa de nuevo por Import).
  function switchUser() {
    localStorage.removeItem('user');
    setUser(null);
    setScreen('user');
  }

  if (screen === 'gate') return <Gate onOk={() => setScreen('user')} />;
  if (screen === 'user') return <UserSelect onPick={pick} />;
  if (screen === 'import' && user) return <Import user={user} onDone={() => setScreen('swipe')} />;
  if (screen === 'swipe' && user) return <Swipe user={user} onSwitch={switchUser} onImport={() => setScreen('import')} />;
  return null;
}
