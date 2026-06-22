// backend/src/middleware/auth.ts
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

// Gate simple por passphrase compartida: la URL es pública, esto mantiene el link privado.
export function requirePassphrase(req: Request, res: Response, next: NextFunction) {
  if (req.headers['x-passphrase'] === config.appPassphrase) return next();
  return res.status(401).json({ error: 'Passphrase inválida' });
}
