import { fromNodeHeaders } from 'better-auth/node';
import { createHash, timingSafeEqual } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import { auth } from '../auth';
import { db, mirrorAccountIntoStore } from '../db/client';
import { agentApiKeys, agents } from '../db/schema';
import { isMasterKey } from '../lib/master-key';
import {
  getParticipantWorkspaceMemberships,
  getUserWorkspaceMemberships as getUserWorkspaceMembershipsForParticipant,
  selectEffectiveWorkspaceId,
} from '../lib/participants';
import { anonymousCapabilities, resolvePublicReadWorkspace, workspaceIdForName } from '../lib/public-read';
import { intersectWorkspaceCaps } from '../lib/scopes';
import type { AuthInfo, Capability, WorkspaceMemberRole } from '../types';
import { computeCapabilities } from './capabilities';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}

export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function _safeCompare(a: string, b: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export interface WorkspaceMembership {
  workspaceId: string;
  memberRole: WorkspaceMemberRole;
}

export async function getAgentWorkspaceMemberships(agentId: string): Promise<WorkspaceMembership[]> {
  return getParticipantWorkspaceMemberships(agentId);
}

export async function getUserWorkspaceMemberships(
  userId: string,
  _linkedAgentId?: string,
): Promise<WorkspaceMembership[]> {
  return getUserWorkspaceMembershipsFromParticipant(userId);
}

export async function getAuthWorkspaceMemberships(authInfo: {
  uid?: string;
  agentId?: string;
}): Promise<WorkspaceMembership[]> {
  if (authInfo.uid) return getUserWorkspaceMembershipsFromParticipant(authInfo.uid);
  if (authInfo.agentId) return getAgentWorkspaceMemberships(authInfo.agentId);
  return [];
}

async function getUserWorkspaceMembershipsFromParticipant(userId: string): Promise<WorkspaceMembership[]> {
  return getUserWorkspaceMembershipsForParticipant(userId);
}

export async function resolveUser(
  userId: string,
  requestedWorkspaceId?: string,
): Promise<{ workspaceId: string; agentId?: string } | null> {
  const [agentRow] = await db
    .select({ id: agents.id, platformAdmin: agents.platformAdmin })
    .from(agents)
    .where(eq(agents.authUserId, userId));
  const agentId = agentRow?.id ?? undefined;
  const isPlatformAdmin = agentRow?.platformAdmin === true;

  if (isPlatformAdmin && requestedWorkspaceId) {
    return { workspaceId: requestedWorkspaceId, agentId };
  }

  const memberships = await getUserWorkspaceMemberships(userId, agentId);
  const effective = selectEffectiveWorkspaceId(memberships, requestedWorkspaceId);
  // No workspace yet, but the participant row may already exist (provisioned
  // by /api/auth/profile). Keep the identity so self-targeted routes such as
  // GET /api/agents/me/keys work before the first workspace is created;
  // capabilities stay empty because there is no workspace to scope them to.
  if (!effective) return agentId ? { workspaceId: '', agentId } : null;
  if (requestedWorkspaceId && effective !== requestedWorkspaceId) {
    console.warn(
      `[auth] user ${userId} sent X-Workspace-Id=${requestedWorkspaceId} (not a membership); using ${effective}`,
    );
  }
  return { workspaceId: effective, agentId };
}

async function resolveAgentWorkspace(
  agentId: string,
  requestedWorkspaceId: string,
): Promise<{ workspaceId: string; memberRole: WorkspaceMemberRole } | null> {
  const memberships = await getAgentWorkspaceMemberships(agentId);
  const direct = memberships.find(row => row.workspaceId === requestedWorkspaceId);
  if (direct) return direct;
  // The caller may have named the floor by slug, which is the only name a link
  // hands out. Memberships hold ids, so match again against the resolved one.
  // This grants nothing: a non-member still finds no membership here.
  const resolved = await workspaceIdForName(requestedWorkspaceId);
  if (!resolved) return null;
  return memberships.find(row => row.workspaceId === resolved) ?? null;
}

/**
 * Bump agent_api_keys.last_used_at when a key resolves successfully, debounced
 * to roughly once per minute per key so we don't write on every request. Run
 * fire-and-forget; auth path latency must not depend on this update.
 */
const LAST_USED_DEBOUNCE_MS = 60_000;
function maybeBumpLastUsed(hash: string, lastUsedAt: Date | null): void {
  const now = Date.now();
  if (lastUsedAt && now - lastUsedAt.getTime() < LAST_USED_DEBOUNCE_MS) return;
  db.update(agentApiKeys)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(agentApiKeys.hash, hash))
    .catch(err => console.error('[auth] failed to bump last_used_at', err));
}

/** Like authMiddleware but never rejects. Unauthenticated requests pass through with req.auth unset. */
export async function optionalAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (isMasterKey(apiKey)) {
    const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
    if (!requestedWorkspaceId) return next();
    req.auth = {
      capabilities: await computeCapabilities({ workspaceId: requestedWorkspaceId, isMasterKey: true }),
      workspaceId: requestedWorkspaceId,
      isMasterKey: true,
    };
    return next();
  }

  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) }).catch(() => null);
  if (session?.user) {
    const requestedWorkspaceId =
      (req.headers['x-workspace-id'] as string | undefined) ??
      (typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined);
    // Identity is global and data is per-store, and the two meet at a
    // foreign key: `agents.auth_user_id` points at THIS store's user table,
    // so on the beta a real account has to have a row here before anything
    // can be created for it (db/client.ts). Done at the point identity is
    // established rather than in each writer, so a new writer cannot forget.
    await mirrorAccountIntoStore(session.user.id);
    const result = await resolveUser(session.user.id, requestedWorkspaceId);
    if (result !== null) {
      req.auth = {
        capabilities: await computeCapabilities({
          workspaceId: result.workspaceId,
          uid: session.user.id,
          agentId: result.agentId,
        }),
        workspaceId: result.workspaceId,
        uid: session.user.id,
        agentId: result.agentId,
      };
    } else {
      // New user with no workspaces yet; set minimal auth so ensureParticipant
      // can run on /me and provision the first workspace.
      req.auth = { capabilities: new Set(), workspaceId: '', uid: session.user.id };
    }
    return next();
  }

  // 3. Agent API key
  const agentKey = req.headers['x-agent-key'] as string | undefined;
  if (agentKey) {
    const hash = hashKey(agentKey);
    const [keyRecord] = await db.select().from(agentApiKeys).where(eq(agentApiKeys.hash, hash));
    if (!keyRecord) {
      console.error(`[optionalAuth] agent key not found in DB (hash ${hash.slice(0, 8)}...)`);
      return next();
    }
    const { agentId } = keyRecord;
    const keyWorkspaceId = keyRecord.workspaceId;
    const keyScopes = (keyRecord.scopes as string[] | null) ?? ['*'];
    if (agentId && keyWorkspaceId) {
      const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
      if (agent) {
        // Same pin as authMiddleware. Here an unauthenticated read is a
        // legitimate outcome, so a locked key pointed elsewhere resolves in
        // its own workspace rather than 403ing a public page.
        const askedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
        const effectiveWorkspaceId = keyRecord.workspaceLocked ? keyWorkspaceId : (askedWorkspaceId ?? keyWorkspaceId);
        const membership = await resolveAgentWorkspace(agentId, effectiveWorkspaceId);
        if (membership) {
          const fullCaps = await computeCapabilities({ workspaceId: membership.workspaceId, agentId });
          req.auth = {
            capabilities: intersectWorkspaceCaps(fullCaps, keyScopes),
            agentId,
            workspaceId: membership.workspaceId,
            scopes: keyScopes,
            keyId: keyRecord.keyId,
          };
          maybeBumpLastUsed(hash, keyRecord.lastUsedAt as Date | null);
        } else {
          console.error(`[optionalAuth] agent ${agentId}: no membership for workspace ${effectiveWorkspaceId}`);
        }
      } else {
        console.error(`[optionalAuth] agent ${agentId}: not found in agents table`);
      }
    } else {
      console.error(`[optionalAuth] key record missing agentId or workspaceId`);
    }
  }
  return next();
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // 1. Master API key → all capabilities, requires X-Workspace-Id
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (isMasterKey(apiKey)) {
    const requestedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
    if (!requestedWorkspaceId) return res.status(400).json({ error: 'X-Workspace-Id header is required' });
    req.auth = {
      capabilities: await computeCapabilities({ workspaceId: requestedWorkspaceId, isMasterKey: true }),
      workspaceId: requestedWorkspaceId,
      isMasterKey: true,
    };
    return next();
  }

  // 2. BetterAuth session (cookie or Bearer token)
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) }).catch(() => null);
  if (session?.user) {
    const requestedWorkspaceId =
      (req.headers['x-workspace-id'] as string | undefined) ??
      (typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined);
    // Identity is global and data is per-store, and the two meet at a
    // foreign key: `agents.auth_user_id` points at THIS store's user table,
    // so on the beta a real account has to have a row here before anything
    // can be created for it (db/client.ts). Done at the point identity is
    // established rather than in each writer, so a new writer cannot forget.
    await mirrorAccountIntoStore(session.user.id);
    const result = await resolveUser(session.user.id, requestedWorkspaceId);
    if (result === null) {
      if (requestedWorkspaceId) {
        console.warn(
          `[auth] user ${session.user.id} has no memberships; ignoring X-Workspace-Id=${requestedWorkspaceId}`,
        );
      }
      req.auth = { capabilities: new Set(), workspaceId: '', uid: session.user.id };
    } else {
      req.auth = {
        capabilities: await computeCapabilities({
          workspaceId: result.workspaceId,
          uid: session.user.id,
          agentId: result.agentId,
        }),
        workspaceId: result.workspaceId,
        uid: session.user.id,
        agentId: result.agentId,
      };
    }
    return next();
  }

  // 3. Agent API key
  const agentKey = req.headers['x-agent-key'] as string | undefined;
  if (agentKey) {
    const hash = hashKey(agentKey);
    const [keyRecord] = await db.select().from(agentApiKeys).where(eq(agentApiKeys.hash, hash));
    if (!keyRecord) return res.status(401).json({ error: 'Invalid agent key' });

    const { agentId } = keyRecord;
    const keyWorkspaceId = keyRecord.workspaceId;
    if (!keyWorkspaceId) {
      return res.status(403).json({ error: 'Agent API key has no workspace assigned' });
    }
    const keyScopes = (keyRecord.scopes as string[] | null) ?? ['*'];

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) return res.status(401).json({ error: 'Agent not found' });

    const askedWorkspaceId = req.headers['x-workspace-id'] as string | undefined;
    // A pinned key's workspace is its whole reach, not a default
    // (docs/guides/auth-and-keys.md): naming another one is refused rather
    // than quietly answered, because "only on this market" has to mean it
    // even when the agent guesses a header.
    if (keyRecord.workspaceLocked && askedWorkspaceId && askedWorkspaceId !== keyWorkspaceId) {
      // Compare ids, not the raw header: a pinned key naming its OWN workspace
      // by slug is the legitimate case, and refusing it would make the lock
      // mean "and you must know the uuid" rather than "only this floor".
      const askedId = await workspaceIdForName(askedWorkspaceId);
      if (askedId !== keyWorkspaceId) {
        return res.status(403).json({ error: 'This key is limited to one workspace and cannot act in another' });
      }
    }
    const effectiveWorkspaceId = keyRecord.workspaceLocked ? keyWorkspaceId : (askedWorkspaceId ?? keyWorkspaceId);
    const membership = await resolveAgentWorkspace(agentId, effectiveWorkspaceId);
    // A valid key without membership in the effective workspace still
    // authenticates, with an EMPTY capability set. This is what lets a
    // freshly created agent bootstrap itself via identity-only routes,
    // most importantly POST /api/marketplace/:id/join - previously those
    // 403'd here, making join unreachable for sub-bots created through
    // POST /api/agents (chicken-and-egg). Every workspace-data route is
    // capability-gated, so a non-member still cannot read or trade.
    const fullCaps = membership
      ? await computeCapabilities({ workspaceId: membership.workspaceId, agentId })
      : new Set<Capability>();
    req.auth = {
      capabilities: intersectWorkspaceCaps(fullCaps, keyScopes),
      agentId,
      workspaceId: membership?.workspaceId ?? effectiveWorkspaceId,
      scopes: keyScopes,
      keyId: keyRecord.keyId,
    };
    maybeBumpLastUsed(hash, keyRecord.lastUsedAt as Date | null);
    return next();
  }

  // No credentials resolved. If an X-API-Key was supplied that did not match the
  // master key (and no X-Agent-Key was present), the caller most likely sent a
  // participant key in the wrong header. Say so, rather than a bare "Unauthorized"
  // that sends agents down a generic auth-debugging path.
  if (apiKey) {
    return res.status(401).json({
      error:
        'Unauthorized: the X-API-Key header was not recognized as the master key. If this is a participant (agent) key, send it in the X-Agent-Key header instead.',
    });
  }

  /**
   * No credentials, but a PUBLIC workspace still answers reads.
   *
   * Owner direction 2026-08-20: "only placing trades or writing comments
   * should require api key... you know the user action stuff". Reading a
   * public market needed a key, which meant an agent had to register before it
   * could see what was being traded, while the same numbers were already open
   * under /api/marketplace/*. Two doors to one fact, one of them locked.
   *
   * The grant is READ and nothing else, deliberately, even when the Public
   * group also carries `trade` (an Open workspace grants that so a self-join
   * makes you a trader). Acting is never anonymous: without an identity there
   * is no account to debit, no author to attach to a comment, and nobody to
   * hold to the rules. requireIdentity and every non-read capability still
   * refuse.
   *
   * The workspace is named the same way it always is, by X-Workspace-Id, and
   * a slug works too, because an anonymous caller reading a public floor has
   * a slug long before it has an id.
   */
  const publicWorkspace =
    (req.headers['x-workspace-id'] as string | undefined) ??
    (typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined);
  if (publicWorkspace) {
    const resolved = await resolvePublicReadWorkspace(publicWorkspace);
    if (resolved) {
      req.auth = { capabilities: anonymousCapabilities(), workspaceId: resolved };
      return next();
    }
  }
  return res.status(401).json({ error: 'Unauthorized' });
}
