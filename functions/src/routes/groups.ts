import { Router } from 'express';
import { db } from '../db/client';
import { agents, permissionGroups } from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { wrap } from '../lib/wrap';
import { requireRole } from '../middleware/roles';
import type { MetricPermission, PermissionGroupType } from '../types';
import { getGroupMemberIds, syncLegacyWorkspaceMemberships } from '../lib/participants';

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
      description: 'Participants explicitly added to this workspace.',
      memberIds: [], agentIds: [], uids: [], permissions: {}, createdAt: new Date(),
    });
  }
  if (!existingTypes.has('admin')) {
    toInsert.push({
      id: randomUUID(), workspaceId, name: 'Admin', type: 'admin',
      description: 'Participants with full administrative access to this workspace.',
      memberIds: [], agentIds: [], uids: [], permissions: {}, createdAt: new Date(),
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
  res.json(rows.map(row => ({ ...row, memberIds: getGroupMemberIds(row) })));
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
    memberIds: [], agentIds: [], uids: [], permissions: {}, createdAt: new Date(),
  });
  res.status(201).json({ id, name: name.trim(), type: 'custom', description, memberIds: [], agentIds: [], uids: [], permissions: {} });
}));

groupsRouter.put('/:id', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const groupId = req.params.id as string;

  const [group] = await db.select().from(permissionGroups)
    .where(and(eq(permissionGroups.id, groupId), eq(permissionGroups.workspaceId, workspaceId)));
  if (!group) { res.status(404).json({ error: 'Group not found' }); return; }

  const { name, description, memberIds, agentIds, uids, permissions } = req.body;
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

  const memberUpdateProvided = memberIds !== undefined || agentIds !== undefined || uids !== undefined;
  if (memberUpdateProvided) {
    const nextMemberIds = memberIds ?? agentIds ?? uids;
    if (!Array.isArray(nextMemberIds) || nextMemberIds.some((id: unknown) => typeof id !== 'string')) {
      res.status(400).json({ error: 'memberIds must be an array of strings' }); return;
    }
    update.memberIds = nextMemberIds;
    update.agentIds = nextMemberIds;
    update.uids = [];

    if (group.type === 'admin') {
      const oldIds = new Set<string>(getGroupMemberIds(group));
      const newIds = new Set<string>(nextMemberIds);
      const added = nextMemberIds.filter((id: string) => !oldIds.has(id));
      const removed = [...oldIds].filter(id => !newIds.has(id));

      if (added.length > 0) {
        await db.update(agents).set({ role: 'admin' }).where(inArray(agents.id, added));
      }
      if (removed.length > 0) {
        await db.update(agents).set({ role: 'agent' }).where(inArray(agents.id, removed));
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
  await syncLegacyWorkspaceMemberships(workspaceId);
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
  await syncLegacyWorkspaceMemberships(workspaceId);
  res.status(204).send();
}));

export { ensureSystemGroups };
