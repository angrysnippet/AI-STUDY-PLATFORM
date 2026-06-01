import type { NextFunction, Request, Response } from 'express';

import { verifyToken } from '../services/auth';
import type { AuthUser } from '../types';

// Make the verified identity available as req.user across the app.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function bearer(req: Request): string {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
}

/** Reject the request unless it carries a valid app JWT. Sets req.user on success. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = verifyToken(bearer(req));
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  req.user = user;
  next();
}

/** Convenience accessor for handlers running behind requireAuth. */
export function userId(req: Request): string {
  return req.user!.id;
}
