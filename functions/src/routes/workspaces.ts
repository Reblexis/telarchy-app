import { Router } from 'express';
import { db } from '../db/client';
import { workspaces, userWorkspaces, permissionGroups } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { wrap } from '../lib/wrap';
import { requireRole, requireIdentity } from '../middleware/roles';

export const workspacesRouter = Router();

workspacesRouter.post('/', requireIdentity, wrap(async (req, res) => {
  const { uid, agentId, role } = req.auth!;
  // Master API key (role=admin, no uid/agentId) gets a synthetic identity.
  const identity = uid ?? agentId ?? (role === 'admin' ? 'admin' : undefined);
  if (!identity) { res.status(403).json({ error: 'Identity required to create a workspace' }); return; }

  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'name is required' }); return;
  }

  const wsId = randomUUID();
  const now = new Date();

  await db.transaction(async tx => {
    await tx.insert(workspaces).values({
      id: wsId,
      name: name.trim(),
      createdBy: identity,
      createdAt: now,
      visibility: 'private',
    });

    // Only insert a user_workspaces row when the creator is a real BetterAuth user.
    // Master API key (uid=undefined) has no authUser row and cannot be a member.
    if (uid) {
      await tx.insert(userWorkspaces).values({
        userId: uid,
        workspaceId: wsId,
        role: 'owner',
        joinedAt: now,
      });
    }

    // Bootstrap Public and Admin permission groups
    await tx.insert(permissionGroups).values([
      {
        id: randomUUID(), workspaceId: wsId,
        name: 'Public', type: 'public',
        description: 'All agents are members of this group automatically.',
        agentIds: [], uids: [], permissions: {}, createdAt: now,
      },
      {
        id: randomUUID(), workspaceId: wsId,
        name: 'Admin', type: 'admin',
        description: 'Agents and users with full administrative access to this workspace.',
        agentIds: agentId ? [agentId] : [],
        uids: uid ? [uid] : [],
        permissions: {}, createdAt: now,
      },
    ]);
  });

  res.status(201).json({ id: wsId, name: name.trim(), visibility: 'private' });
}));

workspacesRouter.get('/', requireIdentity, wrap(async (req, res) => {
  const { uid, agentId, role } = req.auth!;

  // Master API key or platform admin via session — return all workspaces.
  if (!uid && !agentId) {
    const all = await db.select().from(workspaces);
    res.json(all); return;
  }

  if (role === 'admin') {
    const all = await db.select().from(workspaces);
    res.json(all.map(ws => ({ ...ws, memberRole: 'owner' }))); return;
  }

  const identity = uid ?? agentId!;
  const memberships = await db.select().from(userWorkspaces).where(eq(userWorkspaces.userId, identity));
  if (memberships.length === 0) { res.json([]); return; }

  const wsIds = memberships.map(m => m.workspaceId);
  const wsRows = await Promise.all(wsIds.map(id => db.select().from(workspaces).where(eq(workspaces.id, id))));
  const roleMap = Object.fromEntries(memberships.map(m => [m.workspaceId, m.role]));

  res.json(
    wsRows.flatMap(r => r).map(ws => ({ ...ws, memberRole: roleMap[ws.id] })),
  );
}));

workspacesRouter.get('/:id/stats', requireIdentity, wrap(async (req, res) => {
  const wsId = req.params.id as string;
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }
  res.json({ tradedVolume: ws.tradedVolume ?? 0 });
}));

workspacesRouter.get('/:id', requireIdentity, wrap(async (req, res) => {
  const wsId = req.params.id as string;
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }
  res.json(ws);
}));

workspacesRouter.put('/:id/settings', requireRole('admin'), wrap(async (req, res) => {
  const { uid, agentId } = req.auth!;
  const wsId = req.params.id as string;

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }

  // Verify workspace-level admin membership (if not using master key)
  const identity = uid ?? agentId;
  if (identity) {
    const [membership] = await db.select().from(userWorkspaces)
      .where(and(eq(userWorkspaces.userId, identity), eq(userWorkspaces.workspaceId, wsId)));
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      res.status(403).json({ error: 'Only workspace owner or admin can update settings' }); return;
    }
  }

  const { name, customApiUrl } = req.body;
  const update: Partial<typeof workspaces.$inferInsert> = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'name must be a non-empty string' }); return;
    }
    update.name = name.trim();
  }
  if (customApiUrl !== undefined) {
    if (customApiUrl !== null && (typeof customApiUrl !== 'string' || customApiUrl.length === 0)) {
      res.status(400).json({ error: 'customApiUrl must be a non-empty string or null' }); return;
    }
    update.customApiUrl = customApiUrl ?? null;
  }
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: 'No fields to update' }); return;
  }

  await db.update(workspaces).set(update).where(eq(workspaces.id, wsId));
  res.json({ ok: true });
}));

workspacesRouter.post('/:id/join', requireIdentity, wrap(async (_req, res) => {
  res.status(403).json({ error: 'This workspace is invite-only. Add members via permission groups.' });
}));

/**
 * POST /api/workspaces/:id/members
 * Admin-only: add a user to a workspace with a specified role.
 * Requires master API key or workspace owner/admin session.
 * Body: { userId: string, role: 'owner'|'admin'|'trader'|'viewer' }
 */
workspacesRouter.post('/:id/members', requireRole('admin'), wrap(async (req, res) => {
  const { uid, agentId } = req.auth!;
  const wsId = req.params.id as string;

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }

  // If not using master key, require workspace-level owner/admin
  const identity = uid ?? agentId;
  if (identity) {
    const [membership] = await db.select().from(userWorkspaces)
      .where(and(eq(userWorkspaces.userId, identity), eq(userWorkspaces.workspaceId, wsId)));
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      res.status(403).json({ error: 'Only workspace owner or admin can add members' }); return;
    }
  }

  const { userId, role } = req.body;
  if (!userId || typeof userId !== 'string') {
    res.status(400).json({ error: 'userId is required' }); return;
  }
  const validRoles = ['owner', 'admin', 'trader', 'viewer'];
  if (!role || !validRoles.includes(role)) {
    res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` }); return;
  }

  await db.insert(userWorkspaces)
    .values({ userId, workspaceId: wsId, role, joinedAt: new Date() })
    .onConflictDoUpdate({ target: [userWorkspaces.userId, userWorkspaces.workspaceId], set: { role } });

  res.status(201).json({ ok: true, workspaceId: wsId, userId, role });
}));
