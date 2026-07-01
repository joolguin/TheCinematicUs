import type { UserName } from '../types';
import jo from './avatar-jo.png';
import vale from './avatar-vale.png';

export const AVATAR: Record<UserName, string> = { Jo: jo, Vale: vale };

// Color del anillo/acento de cada usuaria.
export const RING: Record<UserName, string> = { Jo: '#16ae3c', Vale: '#f14747' };
