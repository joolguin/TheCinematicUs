import type { UserName } from './types';

export const STORAGE_KEYS = {
  user: 'user',
  passphrase: 'passphrase',
} as const;

export const USER_NAMES: readonly UserName[] = ['Jo', 'Vale'];
