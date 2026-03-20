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

/** Requires any authenticated Firebase user (uid present). Allows all workspace roles. */
export function requireFirebaseUser(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.auth.uid) return res.status(403).json({ error: 'Firebase account required' });
  return next();
}

export function requireSelfOrAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'Unauthorized' });
  if (req.auth.role === 'admin') return next();
  if (req.auth.agentId && req.auth.agentId === req.params.id) return next();
  return res.status(403).json({ error: 'Forbidden' });
}
