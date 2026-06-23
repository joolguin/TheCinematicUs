// frontend/src/types.ts
export type UserName = 'Jo' | 'Vale';

// Placeholder de avatar hasta tener foto: la inicial de cada usuaria.
export const INITIALS: Record<UserName, string> = { Jo: 'J', Vale: 'V' };

// Estado de actividad para la presencia en vivo (no expone likes, solo actividad).
export type PresenceStatus = 'en-linea' | 'swipeando' | 'termino';
