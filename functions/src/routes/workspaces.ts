import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../lib/db';
import { wsCol } from '../lib/workspace';
import { wrap } from '../lib/wrap';
import { requireRole, requireIdentity } from '../middleware/roles';

export const workspacesRouter = Router();

// --- Create workspace ---

workspacesRouter.post('/', requireIdentity, wrap(async (req, res) => {
  const { uid, agentId } = req.auth!;
  const identity = uid ?? agentId!;

  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'name is required' }); return;
  }

  const wsRef = db().collection('workspaces').doc();
  const now = FieldValue.serverTimestamp();
  await db().runTransaction(async tx => {
    tx.set(wsRef, {
      id: wsRef.id,
      name: name.trim(),
      createdBy: identity,
      createdAt: now,
      visibility: 'private',
    });
    // Write discovery index entry for the creator
    tx.set(db().collection('users').doc(identity), {
      workspaces: { [wsRef.id]: { role: 'admin', joinedAt: now } },
    }, { merge: true });
    // Bootstrap system permission groups; creator goes into Admin group
    const groupsCol = wsCol(wsRef.id, 'permissionGroups');
    tx.set(groupsCol.doc(), {
      name: 'Public', type: 'public',
      description: 'All agents are members of this group automatically.',
      agentIds: [], uids: [], permissions: {}, createdAt: now,
    });
    // Add creator uid (if Firebase user) or agentId to Admin group
    const adminGroupData: Record<string, unknown> = {
      name: 'Admin', type: 'admin',
      description: 'Agents and users with full administrative access to this workspace.',
      agentIds: agentId ? [agentId] : [],
      uids: uid ? [uid] : [],
      permissions: {}, createdAt: now,
    };
    tx.set(groupsCol.doc(), adminGroupData);
  });

  res.status(201).json({ id: wsRef.id, name: name.trim(), visibility: 'private' });
}));

// --- List workspaces the current user/agent belongs to ---

workspacesRouter.get('/', requireIdentity, wrap(async (req, res) => {
  const { uid, agentId } = req.auth!;

  if (!uid && !agentId) {
    // Master API key: return all workspaces
    const snap = await db().collection('workspaces').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    return;
  }

  // Use uid for Firebase users, agentId for pure agents
  const identity = uid ?? agentId!;
  const userDoc = await db().collection('users').doc(identity).get();
  if (!userDoc.exists) { res.json([]); return; }

  const workspaces = userDoc.data()!.workspaces as Record<string, { role: string }> | undefined;
  if (!workspaces || Object.keys(workspaces).length === 0) { res.json([]); return; }

  const wsIds = Object.keys(workspaces);
  const wsDocs = await Promise.all(wsIds.map(id => db().collection('workspaces').doc(id).get()));
  res.json(
    wsDocs
      .filter(d => d.exists)
      .map(d => ({ id: d.id, ...d.data(), memberRole: workspaces[d.id].role })),
  );
}));

// --- Workspace stats (traded volume) ---

workspacesRouter.get('/:id/stats', requireIdentity, wrap(async (req, res) => {
  const wsId = req.params.id as string;
  const doc = await db().collection('workspaces').doc(wsId).get();
  if (!doc.exists) { res.status(404).json({ error: 'Workspace not found' }); return; }
  const data = doc.data()!;
  res.json({ tradedVolume: data.tradedVolume ?? 0 });
}));

// --- Get workspace detail ---

workspacesRouter.get('/:id', requireIdentity, wrap(async (req, res) => {
  const wsId = req.params.id as string;
  const doc = await db().collection('workspaces').doc(wsId).get();
  if (!doc.exists) { res.status(404).json({ error: 'Workspace not found' }); return; }
  res.json({ id: doc.id, ...doc.data() });
}));

// --- Update workspace settings ---

workspacesRouter.put('/:id/settings', requireRole('admin'), wrap(async (req, res) => {
  const { uid, agentId } = req.auth!;
  const wsId = req.params.id as string;

  const wsDoc = await db().collection('workspaces').doc(wsId).get();
  if (!wsDoc.exists) { res.status(404).json({ error: 'Workspace not found' }); return; }

  // Only workspace admin or platform admin (master key, no identity) can update settings
  const identity = uid ?? agentId;
  if (identity) {
    const userDoc = await db().collection('users').doc(identity).get();
    const membership = userDoc.data()?.workspaces?.[wsId];
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      res.status(403).json({ error: 'Only workspace owner or admin can update settings' }); return;
    }
  }

  const { name, customApiUrl } = req.body;
  const update: Record<string, unknown> = {};
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
    update.customApiUrl = customApiUrl ?? FieldValue.delete();
  }
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: 'No fields to update' }); return;
  }

  await db().collection('workspaces').doc(wsId).update(update);
  res.json({ ok: true });
}));

// --- Join (disabled: all workspaces are invite-only) ---

workspacesRouter.post('/:id/join', requireIdentity, wrap(async (_req, res) => {
  res.status(403).json({ error: 'This workspace is invite-only. Add members via permission groups.' });
}));
