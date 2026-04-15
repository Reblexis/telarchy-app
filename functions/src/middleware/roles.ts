import { Request, Response, NextFunction } from 'express';
import type { Capability } from '../types';

/**
 * Require that the caller's capability set contains at least one of the given capabilities.
 * Capabilities are the only thing that grants access. Group names ("admin", "trader", etc.)
 * are just labels and do not directly authorize anything.
 */
export function requireCapability(...caps: Capability[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: 'Unauthorized' });
    const have = req.auth.capabilities;
    for (const cap of caps) {
      if (have.has(cap)) return next();
    }
    return res.status(403).json({ error: 'Forbidden' });
  };
}

/** Requires a BetterAuth browser-account session (uid present). */
export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.auth.uid) return res.status(403).json({ error: 'Browser account session required' });
  return next();
}

/** Requires any authenticated identity: uid, agentId, or master API key. */
export function requireIdentity(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.auth.uid && !req.auth.agentId && !req.auth.isMasterKey) {
    return res.status(403).json({ error: 'Identity required' });
  }
  return next();
}

/** Allows access if the caller IS the target agent (by ID or "me"), or if the
 *  caller has the `manage` capability AND the target agent belongs to their workspace. */
export async function requireSelfOrAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'Unauthorized' });
  if (req.params.id === 'me' && req.auth.agentId) return next();
  if (req.auth.agentId && req.auth.agentId === req.params.id) return next();
  if (req.auth.capabilities.has('manage')) {
    const { listParticipantsForWorkspace } = await import('../lib/participants');
    const members = await listParticipantsForWorkspace(req.auth.workspaceId);
    const targetId = req.params.id as string;
    if (members.some(m => m.id === targetId)) return next();
  }
  return res.status(403).json({ error: 'Forbidden' });
}
