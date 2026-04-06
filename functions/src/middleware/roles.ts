import { Request, Response, NextFunction } from 'express';
import type { AgentRole } from '../types';

export function requireRole(...roles: Array<AgentRole | 'admin'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

/** Requires a BetterAuth browser-account session (uid present). */
export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.auth.uid) return res.status(403).json({ error: 'Browser account session required' });
  return next();
}

/** Requires any authenticated identity - either a Firebase uid or an agent agentId.
 *  Master API key (role=admin, no uid/agentId) is also allowed through. */
export function requireIdentity(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.auth.uid && !req.auth.agentId && req.auth.role !== 'admin') return res.status(403).json({ error: 'Identity required' });
  return next();
}

export function requireSelfOrAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'Unauthorized' });
  if (req.auth.role === 'admin') return next();
  if (req.params.id === 'me' && req.auth.agentId) return next();
  if (req.auth.agentId && req.auth.agentId === req.params.id) return next();
  return res.status(403).json({ error: 'Forbidden' });
}
