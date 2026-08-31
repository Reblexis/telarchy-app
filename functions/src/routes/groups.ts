import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { agents, permissionGroups } from '../db/schema';
import { getGroupMemberIds } from '../lib/participants';
import { wrap } from '../lib/wrap';
import { requireCapability, requireIdentity } from '../middleware/roles';
import type { Capability, MetricPermission, PermissionGroupType, SourcePermission } from '../types';

export const groupsRouter = Router();

const SYSTEM_GROUP_TYPES: PermissionGroupType[] = ['public', 'admin', 'trader'];

/** Default capability presets for the three system group types. Group names are only labels;
 *  these presets are what actually grants access. Admins may edit Trader/Public/Custom capabilities. */
export const SYSTEM_GROUP_CAPABILITIES: Record<'public' | 'admin' | 'trader', Capability[]> = {
  public: ['read'],
  admin: ['read', 'trade', 'manage', 'manage_workspace'],
  trader: ['read', 'trade'],
};

async function ensureSystemGroups(workspaceId: string): Promise<void> {
  const existing = await db
    .select({ type: permissionGroups.type })
    .from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, workspaceId), inArray(permissionGroups.type, SYSTEM_GROUP_TYPES)));
  const existingTypes = new Set(existing.map(r => r.type));

  const toInsert: (typeof permissionGroups.$inferInsert)[] = [];
  if (!existingTypes.has('public')) {
    toInsert.push({
      id: randomUUID(),
      workspaceId,
      name: 'Public',
      type: 'public',
      description: 'Participants explicitly added to this workspace.',
      memberIds: [],
      permissions: {},
      capabilities: SYSTEM_GROUP_CAPABILITIES.public,
      createdAt: new Date(),
    });
  }
  if (!existingTypes.has('admin')) {
    toInsert.push({
      id: randomUUID(),
      workspaceId,
      name: 'Admin',
      type: 'admin',
      description: 'Participants with full administrative access to this workspace.',
      memberIds: [],
      permissions: {},
      capabilities: SYSTEM_GROUP_CAPABILITIES.admin,
      createdAt: new Date(),
    });
  }
  if (!existingTypes.has('trader')) {
    toInsert.push({
      id: randomUUID(),
      workspaceId,
      name: 'Trader',
      type: 'trader',
      description: 'Participants who can view metrics and trade on all markets.',
      memberIds: [],
      permissions: {},
      capabilities: SYSTEM_GROUP_CAPABILITIES.trader,
      createdAt: new Date(),
    });
  }
  if (toInsert.length > 0) await db.insert(permissionGroups).values(toInsert);
}

const VALID_CAPS = new Set<Capability>(['read', 'trade', 'manage', 'manage_workspace']);
function parseCapabilities(input: unknown): { ok: true; value: Capability[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'capabilities must be an array of strings' };
  const result: Capability[] = [];
  for (const v of input) {
    if (typeof v !== 'string' || !VALID_CAPS.has(v as Capability)) {
      return {
        ok: false,
        error: `capabilities contains invalid entry "${String(v)}"; allowed: read, trade, manage, manage_workspace`,
      };
    }
    if (!result.includes(v as Capability)) result.push(v as Capability);
  }
  return { ok: true, value: result };
}

/**
 * Member-only read (owner direction 2026-08-20). Anonymous callers can read a
 * public workspace's MARKET data without a key, but not its internals: this
 * endpoint answers who is in which permission group / what a source is
 * configured with, which is workspace plumbing rather than a price. An
 * identity is cheap (register, or self-join an Open workspace) and it makes
 * the read attributable.
 */
groupsRouter.get(
  '/',
  requireIdentity,
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    await ensureSystemGroups(workspaceId);
    const rows = await db
      .select()
      .from(permissionGroups)
      .where(eq(permissionGroups.workspaceId, workspaceId))
      .orderBy(permissionGroups.name);
    res.json(rows.map(row => ({ ...row, memberIds: getGroupMemberIds(row) })));
  }),
);

groupsRouter.post(
  '/',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const { name, description = '' } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    let capabilities: Capability[] = [];
    if (req.body.capabilities !== undefined) {
      const parsed = parseCapabilities(req.body.capabilities);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      capabilities = parsed.value;
    }

    const id = randomUUID();
    await db.insert(permissionGroups).values({
      id,
      workspaceId,
      name: name.trim(),
      type: 'custom',
      description: typeof description === 'string' ? description.trim() : '',
      memberIds: [],
      permissions: {},
      capabilities,
      createdAt: new Date(),
    });
    res.status(201).json({
      id,
      name: name.trim(),
      type: 'custom',
      description,
      memberIds: [],
      permissions: {},
      sourcePermissions: {},
      capabilities,
    });
  }),
);

groupsRouter.put(
  '/:id',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const groupId = req.params.id as string;

    const [group] = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.id, groupId), eq(permissionGroups.workspaceId, workspaceId)));
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const { name, description, memberIds, permissions, sourcePermissions, capabilities } = req.body;
    const update: Partial<typeof permissionGroups.$inferInsert> = {};

    if (name !== undefined) {
      if (SYSTEM_GROUP_TYPES.includes(group.type as PermissionGroupType)) {
        res.status(400).json({ error: 'System groups cannot be renamed' });
        return;
      }
      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'name must be a non-empty string' });
        return;
      }
      update.name = name.trim();
    }

    if (description !== undefined) {
      if (typeof description !== 'string') {
        res.status(400).json({ error: 'description must be a string' });
        return;
      }
      update.description = description.trim();
    }

    if (memberIds !== undefined) {
      const nextMemberIds = memberIds;
      if (!Array.isArray(nextMemberIds) || nextMemberIds.some((id: unknown) => typeof id !== 'string')) {
        res.status(400).json({ error: 'memberIds must be an array of strings' });
        return;
      }
      // Every id must name a real participant. Membership decides what a
      // floor shows someone, so a typo silently grants nothing to nobody and
      // a made-up id sits in the group forever. It is also the array the
      // account-authority bug composed with, so it is worth being strict
      // about (bug hunt 2026-08-31); the authority fix itself is in
      // middleware/roles.ts.
      const unique = [...new Set(nextMemberIds as string[])];
      if (unique.length > 0) {
        const known = await db.select({ id: agents.id }).from(agents).where(inArray(agents.id, unique));
        const knownIds = new Set(known.map(r => r.id));
        const unknown = unique.filter(id => !knownIds.has(id));
        if (unknown.length > 0) {
          res.status(400).json({ error: `No such participant: ${unknown.slice(0, 5).join(', ')}` });
          return;
        }
      }
      update.memberIds = unique;
    }

    if (permissions !== undefined) {
      if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions)) {
        res.status(400).json({ error: 'permissions must be an object' });
        return;
      }
      for (const [metricId, perms] of Object.entries(permissions)) {
        const p = perms as MetricPermission;
        if (typeof p.read !== 'boolean' || typeof p.trade !== 'boolean') {
          res.status(400).json({ error: `permissions["${metricId}"] must have boolean read and trade` });
          return;
        }
      }
      update.permissions = permissions;
    }

    if (sourcePermissions !== undefined) {
      if (typeof sourcePermissions !== 'object' || sourcePermissions === null || Array.isArray(sourcePermissions)) {
        res.status(400).json({ error: 'sourcePermissions must be an object' });
        return;
      }
      for (const [sourceId, perms] of Object.entries(sourcePermissions)) {
        const p = perms as SourcePermission;
        if (typeof p.read !== 'boolean') {
          res.status(400).json({ error: `sourcePermissions["${sourceId}"] must have boolean read` });
          return;
        }
      }
      update.sourcePermissions = sourcePermissions;
    }

    if (capabilities !== undefined) {
      const parsed = parseCapabilities(capabilities);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      update.capabilities = parsed.value;
    }

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    await db
      .update(permissionGroups)
      .set(update)
      .where(and(eq(permissionGroups.id, groupId), eq(permissionGroups.workspaceId, workspaceId)));
    res.json({ ok: true });
  }),
);

groupsRouter.delete(
  '/:id',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const groupId = req.params.id as string;

    const [group] = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.id, groupId), eq(permissionGroups.workspaceId, workspaceId)));
    if (!group) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    if (SYSTEM_GROUP_TYPES.includes(group.type as PermissionGroupType)) {
      res.status(400).json({ error: 'System groups cannot be deleted' });
      return;
    }

    await db
      .delete(permissionGroups)
      .where(and(eq(permissionGroups.id, groupId), eq(permissionGroups.workspaceId, workspaceId)));
    res.status(204).send();
  }),
);

export { ensureSystemGroups };
