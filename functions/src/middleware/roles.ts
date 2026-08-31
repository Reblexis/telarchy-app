import type { NextFunction, Request, Response } from 'express';
import type { AccountScope, KeyScope } from '../lib/scopes';
import { hasScope } from '../lib/scopes';
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
    // Name the capability the caller is missing so agents can decide
    // programmatically (request a scope upgrade, skip the workspace, etc.)
    // instead of getting a bare "Forbidden" with no signal.
    const need = caps.length === 1 ? `the "${caps[0]}" capability` : `one of these capabilities: ${caps.join(', ')}`;
    return res.status(403).json({
      error: `Forbidden: this identity lacks ${need} in this workspace. Capabilities come from your permission-group membership; ask a workspace admin to grant it, or use a workspace where your group has it.`,
      requiredCapabilities: caps,
    });
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

/**
 * Per-key scope gate. Browser sessions and the master API key bypass scope
 * checks; only agent-key callers carry a `scopes` array on req.auth, and they
 * must include the named scope (or the wildcard '*'). Use this on
 * account/identity endpoints, alongside requireIdentity / requireSelfOrAdmin.
 *
 * Implication: for workspace endpoints, scopes are already intersected into
 * req.auth.capabilities by the auth middleware, so requireCapability is
 * sufficient. requireScope is only needed for routes that are not workspace-
 * capability-gated (e.g. profile, key management, register-as-me).
 */
export function requireScope(scope: KeyScope | AccountScope) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: 'Unauthorized' });
    // Browser session and master key: scopes don't apply.
    if (req.auth.uid || req.auth.isMasterKey) return next();
    // Agent-key caller: must have the scope.
    if (!hasScope(req.auth.scopes, scope)) {
      return res.status(403).json({ error: `Forbidden: this API key is missing the "${scope}" scope` });
    }
    return next();
  };
}

/**
 * ACCOUNT-LEVEL authority: the participant themselves, or whoever created
 * them. Workspace `manage` is deliberately not enough.
 *
 * Minting an API key, spending a balance, repointing a payout wallet and
 * withdrawing are acts whose blast radius is the whole platform, not one
 * floor. `manage` is a per-workspace capability, and workspace membership
 * is written from a caller-supplied array of ids (PUT /api/groups/:id,
 * POST /api/workspaces/:id/members), so treating membership as authority
 * over an account let anyone with an account take over any participant:
 * open a floor, write the victim's id into its Public group, mint them a
 * wildcard key. The key is not workspace-locked, so it answered in the
 * victim's own private floor too (bug hunt 2026-08-31).
 *
 * Reads stay on `requireSelfOrAdmin` below: a floor's admin is entitled to
 * a co-member's trading data, which is what they came for.
 */
export async function requireSelfOrOwner(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'Unauthorized' });
  if (req.params.id === 'me' && req.auth.agentId) return next();
  if (req.auth.agentId && req.auth.agentId === req.params.id) return next();
  if (req.params.id && req.params.id !== 'me') {
    const { db } = await import('../db/client');
    const { agents } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const [target] = await db
      .select({ ownerAgentId: agents.ownerAgentId, ownerUserId: agents.ownerUserId })
      .from(agents)
      .where(eq(agents.id, req.params.id as string));
    // A sub-bot created through POST /api/agents records its creator:
    // ownerAgentId for an agent-key caller, ownerUserId for a browser one.
    if (target?.ownerAgentId && req.auth.agentId && target.ownerAgentId === req.auth.agentId) return next();
    if (target?.ownerUserId && req.auth.uid && target.ownerUserId === req.auth.uid) return next();
  }
  return res.status(403).json({ error: 'Forbidden' });
}

/** Allows access if the caller IS the target agent (by ID or "me"), or if the
 *  caller has the `manage` capability AND the target agent belongs to their workspace. */
export async function requireSelfOrAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'Unauthorized' });
  if (req.params.id === 'me' && req.auth.agentId) return next();
  if (req.auth.agentId && req.auth.agentId === req.params.id) return next();
  // Parent-agent management: an agent that created a sub-bot via
  // POST /api/agents (agents.ownerAgentId) may manage that bot's
  // account-level resources (keys, spend) the same way a human owner can.
  if (req.auth.agentId && req.params.id && req.params.id !== 'me') {
    const { db } = await import('../db/client');
    const { agents } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const [target] = await db
      .select({ ownerAgentId: agents.ownerAgentId })
      .from(agents)
      .where(eq(agents.id, req.params.id as string));
    if (target?.ownerAgentId === req.auth.agentId) return next();
  }
  if (req.auth.capabilities.has('manage')) {
    const { listParticipantsForWorkspace } = await import('../lib/participants');
    const members = await listParticipantsForWorkspace(req.auth.workspaceId);
    const targetId = req.params.id as string;
    if (members.some(m => m.id === targetId)) return next();
  }
  return res.status(403).json({ error: 'Forbidden' });
}
