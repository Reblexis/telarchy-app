import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../lib/db';
import { wsCol } from '../lib/workspace';
import { wrap } from '../lib/wrap';
import { requireRole } from '../middleware/roles';
import type { MetricPermission, PermissionGroupType } from '../types';

export const groupsRouter = Router();

const SYSTEM_GROUP_TYPES: PermissionGroupType[] = ['public', 'admin'];

/** Ensure the workspace has its Public and Admin system groups, creating them if absent. */
async function ensureSystemGroups(workspaceId: string): Promise<void> {
  const col = wsCol(workspaceId, 'permissionGroups');
  const snap = await col.where('type', 'in', ['public', 'admin']).get();
  const existingTypes = new Set(snap.docs.map(d => d.data().type as PermissionGroupType));

  const batch = db().batch();
  if (!existingTypes.has('public')) {
    batch.set(col.doc(), {
      name: 'Public',
      type: 'public',
      description: 'All agents are members of this group automatically.',
      agentIds: [],
      permissions: {},
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  if (!existingTypes.has('admin')) {
    batch.set(col.doc(), {
      name: 'Admin',
      type: 'admin',
      description: 'Agents with full administrative access to this workspace.',
      agentIds: [],
      permissions: {},
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  if (!existingTypes.has('public') || !existingTypes.has('admin')) {
    await batch.commit();
  }
}

// --- List groups — readable by all authenticated agents ---

groupsRouter.get('/', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  await ensureSystemGroups(workspaceId);
  const snap = await wsCol(workspaceId, 'permissionGroups').orderBy('name').get();
  res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
}));

// --- Create custom group (admin only) ---

groupsRouter.post('/', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const { name, description = '' } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' }); return;
  }
  const ref = await wsCol(workspaceId, 'permissionGroups').add({
    name: name.trim(),
    type: 'custom' as PermissionGroupType,
    description: typeof description === 'string' ? description.trim() : '',
    agentIds: [],
    permissions: {},
    createdAt: FieldValue.serverTimestamp(),
  });
  res.status(201).json({ id: ref.id, name: name.trim(), type: 'custom', description, agentIds: [], permissions: {} });
}));

// --- Update group (admin only) ---

groupsRouter.put('/:id', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const groupId = req.params.id as string;

  const ref = wsCol(workspaceId, 'permissionGroups').doc(groupId);
  const doc = await ref.get();
  if (!doc.exists) { res.status(404).json({ error: 'Group not found' }); return; }
  const current = doc.data()!;

  const { name, description, agentIds, permissions } = req.body;
  const update: Record<string, unknown> = {};

  if (name !== undefined) {
    if (SYSTEM_GROUP_TYPES.includes(current.type)) {
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

    // Sync agent.role for admin-type groups
    if (current.type === 'admin') {
      const oldIds = new Set<string>(current.agentIds ?? []);
      const newIds = new Set<string>(agentIds);
      const added = agentIds.filter((id: string) => !oldIds.has(id));
      const removed = [...oldIds].filter(id => !newIds.has(id));

      const roleBatch = db().batch();
      for (const id of added) {
        roleBatch.update(db().collection('agents').doc(id), { role: 'admin' });
      }
      for (const id of removed) {
        roleBatch.update(db().collection('agents').doc(id), { role: 'agent' });
      }
      if (added.length || removed.length) await roleBatch.commit();
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

  await ref.update(update);
  res.json({ ok: true });
}));

// --- Delete group (admin only, system groups protected) ---

groupsRouter.delete('/:id', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const groupId = req.params.id as string;
  const ref = wsCol(workspaceId, 'permissionGroups').doc(groupId);
  const doc = await ref.get();
  if (!doc.exists) { res.status(404).json({ error: 'Group not found' }); return; }
  if (SYSTEM_GROUP_TYPES.includes(doc.data()!.type)) {
    res.status(400).json({ error: 'System groups cannot be deleted' }); return;
  }
  await ref.delete();
  res.status(204).send();
}));

export { ensureSystemGroups };
