import { Router } from 'express';
import { db } from '../db/client';
import { agents, permissionGroups, userWorkspaces } from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { wrap } from '../lib/wrap';
import { requireRole } from '../middleware/roles';
import type { MetricPermission, PermissionGroupType } from '../types';

export const groupsRouter = Router();

const SYSTEM_GROUP_TYPES: PermissionGroupType[] = ['public', 'admin'];

async function ensureSystemGroups(workspaceId: string): Promise<void> {
  const existing = await db.select({ type: permissionGroups.type }).from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, workspaceId), inArray(permissionGroups.type, ['public', 'admin'])));
  const existingTypes = new Set(existing.map(r => r.type));

  const toInsert: typeof permissionGroups.$inferInsert[] = [];
  if (!existingTypes.has('public')) {
    toInsert.push({
      id: randomUUID(), workspaceId, name: 'Public', type: 'public',
      description: 'All agents are members of this group automatically.',
      agentIds: [], uids: [], permissions: {}, createdAt: new Date(),
    });
  }
  if (!existingTypes.has('admin')) {
    toInsert.push({
      id: randomUUID(), workspaceId, name: 'Admin', type: 'admin',
      description: 'Agents and users with full administrative access to this workspace.',
      agentIds: [], uids: [], permissions: {}, createdAt: new Date(),
    });
  }
  if (toInsert.length > 0) await db.insert(permissionGroups).values(toInsert);
}

groupsRouter.get('/', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  await ensureSystemGroups(workspaceId);
  const rows = await db.select().from(permissionGroups)
    .where(eq(permissionGroups.workspaceId, workspaceId))
    .orderBy(permissionGroups.name);
  res.json(rows);
}));

groupsRouter.post('/', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const { name, description = '' } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' }); return;
  }

  const id = randomUUID();
  await db.insert(permissionGroups).values({
    id, workspaceId,
    name: name.trim(),
    type: 'custom',
    description: typeof description === 'string' ? description.trim() : '',
    agentIds: [], uids: [], permissions: {}, createdAt: new Date(),
  });
  res.status(201).json({ id, name: name.trim(), type: 'custom', description, agentIds: [], uids: [], permissions: {} });
}));

groupsRouter.put('/:id', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const groupId = req.params.id as string;

  const [group] = await db.select().from(permissionGroups)
    .where(and(eq(permissionGroups.id, groupId), eq(permissionGroups.workspaceId, workspaceId)));
  if (!group) { res.status(404).json({ error: 'Group not found' }); return; }

  const { name, description, agentIds, uids, permissions } = req.body;
  const update: Partial<typeof permissionGroups.$inferInsert> = {};

  if (name !== undefined) {
    if (SYSTEM_GROUP_TYPES.includes(group.type as PermissionGroupType)) {
      res.status(400).json({ error: 'System groups cannot be renamed' }); return;
    }
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name must be a non-empty string' }); return;
    }
    update.name = name.trim();
  }

  if (description !== undefined) {
    if (typeof description !== 'string') {
      res.status(400).json({ error: 'description must be a string' }); return;
    }
    update.description = description.trim();
  }

  if (agentIds !== undefined) {
    if (!Array.isArray(agentIds) || agentIds.some((a: unknown) => typeof a !== 'string')) {
      res.status(400).json({ error: 'agentIds must be an array of strings' }); return;
    }
    update.agentIds = agentIds;

    if (group.type === 'admin') {
      const oldIds = new Set<string>((group.agentIds as string[]) ?? []);
      const newIds = new Set<string>(agentIds);
      const added = agentIds.filter((id: string) => !oldIds.has(id));
      const removed = [...oldIds].filter(id => !newIds.has(id));

      if (added.length) {
        for (const id of added) {
          await db.update(agents).set({ role: 'admin' }).where(eq(agents.id, id));
        }
      }
      if (removed.length) {
        for (const id of removed) {
          await db.update(agents).set({ role: 'agent' }).where(eq(agents.id, id));
        }
      }
    }
  }

  if (uids !== undefined) {
    if (!Array.isArray(uids) || uids.some((u: unknown) => typeof u !== 'string')) {
      res.status(400).json({ error: 'uids must be an array of strings' }); return;
    }
    update.uids = uids;

    const oldUids = new Set<string>((group.uids as string[]) ?? []);
    const newUids = new Set<string>(uids);
    const addedUids = uids.filter((id: string) => !oldUids.has(id));
    const removedUids = [...oldUids].filter(id => !newUids.has(id));

    const allGroups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, workspaceId));

    if (group.type === 'admin') {
      for (const uid of addedUids) {
        await db.insert(userWorkspaces)
          .values({ userId: uid, workspaceId, role: 'admin', joinedAt: new Date() })
          .onConflictDoUpdate({ target: [userWorkspaces.userId, userWorkspaces.workspaceId], set: { role: 'admin' } });
      }
      for (const uid of removedUids) {
        const isInOtherGroup = allGroups.some(g => {
          if (g.id === groupId) return false;
          return (g.uids as string[])?.includes(uid);
        });
        if (isInOtherGroup) {
          await db.update(userWorkspaces).set({ role: 'trader' })
            .where(and(eq(userWorkspaces.userId, uid), eq(userWorkspaces.workspaceId, workspaceId)));
        } else {
          await db.delete(userWorkspaces)
            .where(and(eq(userWorkspaces.userId, uid), eq(userWorkspaces.workspaceId, workspaceId)));
        }
      }
    } else {
      for (const uid of addedUids) {
        const [existing] = await db.select().from(userWorkspaces)
          .where(and(eq(userWorkspaces.userId, uid), eq(userWorkspaces.workspaceId, workspaceId)));
        if (existing?.role !== 'admin') {
          await db.insert(userWorkspaces)
            .values({ userId: uid, workspaceId, role: 'trader', joinedAt: new Date() })
            .onConflictDoUpdate({ target: [userWorkspaces.userId, userWorkspaces.workspaceId], set: { role: 'trader' } });
        }
      }
      for (const uid of removedUids) {
        const adminGroup = allGroups.find(g => g.type === 'admin');
        const isAdmin = (adminGroup?.uids as string[])?.includes(uid);
        const isInOtherGroup = allGroups.some(g => {
          if (g.id === groupId) return false;
          return (g.uids as string[])?.includes(uid);
        });
        if (!isAdmin && !isInOtherGroup) {
          await db.delete(userWorkspaces)
            .where(and(eq(userWorkspaces.userId, uid), eq(userWorkspaces.workspaceId, workspaceId)));
        }
      }
    }
  }

  if (permissions !== undefined) {
    if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions)) {
      res.status(400).json({ error: 'permissions must be an object' }); return;
    }
    for (const [metricId, perms] of Object.entries(permissions)) {
      const p = perms as MetricPermission;
      if (typeof p.read !== 'boolean' || typeof p.trade !== 'boolean') {
        res.status(400).json({ error: `permissions["${metricId}"] must have boolean read and trade` }); return;
      }
    }
    update.permissions = permissions;
  }

  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: 'No fields to update' }); return;
  }

  await db.update(permissionGroups).set(update)
    .where(and(eq(permissionGroups.id, groupId), eq(permissionGroups.workspaceId, workspaceId)));
  res.json({ ok: true });
}));

groupsRouter.delete('/:id', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const groupId = req.params.id as string;

  const [group] = await db.select().from(permissionGroups)
    .where(and(eq(permissionGroups.id, groupId), eq(permissionGroups.workspaceId, workspaceId)));
  if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
  if (SYSTEM_GROUP_TYPES.includes(group.type as PermissionGroupType)) {
    res.status(400).json({ error: 'System groups cannot be deleted' }); return;
  }

  await db.delete(permissionGroups)
    .where(and(eq(permissionGroups.id, groupId), eq(permissionGroups.workspaceId, workspaceId)));
  res.status(204).send();
}));

export { ensureSystemGroups };
