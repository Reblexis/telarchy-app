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
      uids: [],
      permissions: {},
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  if (!existingTypes.has('admin')) {
    batch.set(col.doc(), {
      name: 'Admin',
      type: 'admin',
      description: 'Agents and users with full administrative access to this workspace.',
      agentIds: [],
      uids: [],
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
    uids: [],
    permissions: {},
    createdAt: FieldValue.serverTimestamp(),
  });
  res.status(201).json({ id: ref.id, name: name.trim(), type: 'custom', description, agentIds: [], uids: [], permissions: {} });
}));

// --- Update group (admin only) ---

groupsRouter.put('/:id', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const groupId = req.params.id as string;

  const ref = wsCol(workspaceId, 'permissionGroups').doc(groupId);
  const doc = await ref.get();
  if (!doc.exists) { res.status(404).json({ error: 'Group not found' }); return; }
  const current = doc.data()!;

  const { name, description, agentIds, uids, permissions } = req.body;
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

  if (uids !== undefined) {
    if (!Array.isArray(uids) || uids.some((u: unknown) => typeof u !== 'string')) {
      res.status(400).json({ error: 'uids must be an array of strings' }); return;
    }
    update.uids = uids;

    const oldUids = new Set<string>(current.uids ?? []);
    const newUids = new Set<string>(uids);
    const addedUids = uids.filter((id: string) => !oldUids.has(id));
    const removedUids = [...oldUids].filter(id => !newUids.has(id));

    if (addedUids.length || removedUids.length) {
      const uidBatch = db().batch();

      if (current.type === 'admin') {
        // Admin group: added → workspace role 'admin', removed → check if still in any group
        for (const uid of addedUids) {
          uidBatch.set(db().collection('users').doc(uid), {
            workspaces: { [workspaceId]: { role: 'admin', joinedAt: FieldValue.serverTimestamp() } },
          }, { merge: true });
        }
        for (const uid of removedUids) {
          // Check remaining groups for this uid to determine fallback role
          const allGroupsSnap = await wsCol(workspaceId, 'permissionGroups').get();
          const isInOtherGroup = allGroupsSnap.docs.some(d => {
            if (d.id === groupId) return false;
            const otherUids: string[] = d.data().uids ?? [];
            return otherUids.includes(uid);
          });
          if (isInOtherGroup) {
            uidBatch.set(db().collection('users').doc(uid), {
              workspaces: { [workspaceId]: { role: 'trader', joinedAt: FieldValue.serverTimestamp() } },
            }, { merge: true });
          } else {
            uidBatch.update(db().collection('users').doc(uid), {
              [`workspaces.${workspaceId}`]: FieldValue.delete(),
            });
          }
        }
      } else {
        // Non-admin group: added → ensure workspace entry exists (don't overwrite 'admin')
        for (const uid of addedUids) {
          const userDoc = await db().collection('users').doc(uid).get();
          const currentRole = userDoc.data()?.workspaces?.[workspaceId]?.role;
          if (currentRole !== 'admin') {
            uidBatch.set(db().collection('users').doc(uid), {
              workspaces: { [workspaceId]: { role: 'trader', joinedAt: FieldValue.serverTimestamp() } },
            }, { merge: true });
          }
        }
        for (const uid of removedUids) {
          // Check if still in any group (including admin)
          const allGroupsSnap = await wsCol(workspaceId, 'permissionGroups').get();
          const adminGroup = allGroupsSnap.docs.find(d => d.data().type === 'admin');
          const adminUids: string[] = adminGroup?.data().uids ?? [];
          const isAdmin = adminUids.includes(uid);
          const isInOtherGroup = allGroupsSnap.docs.some(d => {
            if (d.id === groupId) return false;
            const otherUids: string[] = d.data().uids ?? [];
            return otherUids.includes(uid);
          });
          if (!isAdmin && !isInOtherGroup) {
            uidBatch.update(db().collection('users').doc(uid), {
              [`workspaces.${workspaceId}`]: FieldValue.delete(),
            });
          }
        }
      }

      await uidBatch.commit();
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
