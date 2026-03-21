import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { wsCol } from '../lib/workspace';
import { wrap } from '../lib/wrap';
import { requireRole } from '../middleware/roles';
import type { MetricPermission } from '../types';

export const groupsRouter = Router();

// All group routes require admin
groupsRouter.use(requireRole('admin'));

// --- List groups ---

groupsRouter.get('/', wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const snap = await wsCol(workspaceId, 'permissionGroups').orderBy('name').get();
  res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
}));

// --- Create group ---

groupsRouter.post('/', wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const { name } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' }); return;
  }
  const ref = await wsCol(workspaceId, 'permissionGroups').add({
    name: name.trim(),
    agentIds: [],
    permissions: {},
    createdAt: FieldValue.serverTimestamp(),
  });
  res.status(201).json({ id: ref.id, name: name.trim(), agentIds: [], permissions: {} });
}));

// --- Update group (name, agentIds, permissions) ---

groupsRouter.put('/:id', wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const groupId = req.params.id as string;

  const ref = wsCol(workspaceId, 'permissionGroups').doc(groupId);
  const doc = await ref.get();
  if (!doc.exists) { res.status(404).json({ error: 'Group not found' }); return; }

  const { name, agentIds, permissions } = req.body;
  const update: Record<string, unknown> = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name must be a non-empty string' }); return;
    }
    update.name = name.trim();
  }

  if (agentIds !== undefined) {
    if (!Array.isArray(agentIds) || agentIds.some((a: unknown) => typeof a !== 'string')) {
      res.status(400).json({ error: 'agentIds must be an array of strings' }); return;
    }
    update.agentIds = agentIds;
  }

  if (permissions !== undefined) {
    if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions)) {
      res.status(400).json({ error: 'permissions must be an object' }); return;
    }
    for (const [metricId, perms] of Object.entries(permissions)) {
      const p = perms as MetricPermission;
      if (typeof p.read !== 'boolean' || typeof p.trade !== 'boolean') {
        res.status(400).json({ error: `permissions["${metricId}"] must have boolean read and trade fields` }); return;
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

// --- Delete group ---

groupsRouter.delete('/:id', wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const groupId = req.params.id as string;
  const ref = wsCol(workspaceId, 'permissionGroups').doc(groupId);
  const doc = await ref.get();
  if (!doc.exists) { res.status(404).json({ error: 'Group not found' }); return; }
  await ref.delete();
  res.status(204).send();
}));
