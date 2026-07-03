import { useState } from 'react';
import './index.css';
import { Gate } from './screens/Gate';
import { UserSelect } from './screens/UserSelect';
import { Watchlists } from './screens/Watchlists';
import { Swipe } from './screens/Swipe';
import type { UserName } from './types';
import { STORAGE_KEYS, USER_NAMES } from './constants';

type Screen = 'gate' | 'user' | 'watchlists' | 'swipe';

function storedUser(): UserName | null {
  const stored = localStorage.getItem(STORAGE_KEYS.user);
  return USER_NAMES.includes(stored as UserName) ? (stored as UserName) : null;
}

function initialScreen(): Screen {
  if (!localStorage.getItem(STORAGE_KEYS.passphrase)) return 'gate';
  return storedUser() ? 'swipe' : 'user';
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [user, setUser] = useState<UserName | null>(storedUser);

  function pick(u: UserName) {
    localStorage.setItem(STORAGE_KEYS.user, u);
    setUser(u);
    setScreen('swipe');
  }

  function switchUser() {
    localStorage.removeItem(STORAGE_KEYS.user);
    setUser(null);
    setScreen('user');
  }

  if (screen === 'gate') return <Gate onOk={() => setScreen('user')} />;
  if (screen === 'user') return <UserSelect onPick={pick} />;
  if (screen === 'watchlists' && user)
    return <Watchlists user={user} onDone={() => setScreen('swipe')} onSwitch={switchUser} />;
  if (screen === 'swipe' && user)
    return <Swipe user={user} onWatchlists={() => setScreen('watchlists')} />;
  return null;
}
