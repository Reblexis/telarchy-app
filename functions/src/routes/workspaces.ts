import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../lib/db';
import { wsCol } from '../lib/workspace';
import { wrap } from '../lib/wrap';
import { requireRole, requireIdentity } from '../middleware/roles';
import type { WorkspaceMemberRole } from '../types';

export const workspacesRouter = Router();

const VALID_MEMBER_ROLES: WorkspaceMemberRole[] = ['owner', 'admin', 'trader', 'viewer'];

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
    // Record membership keyed by identity (uid for Firebase users, agentId for pure agents)
    tx.set(db().collection('users').doc(identity), {
      workspaces: { [wsRef.id]: { role: 'owner', joinedAt: now } },
    }, { merge: true });
    // Bootstrap system permission groups
    const groupsCol = wsCol(wsRef.id, 'permissionGroups');
    tx.set(groupsCol.doc(), {
      name: 'Public', type: 'public',
      description: 'All agents are members of this group automatically.',
      agentIds: [], permissions: {}, createdAt: now,
    });
    tx.set(groupsCol.doc(), {
      name: 'Admin', type: 'admin',
      description: 'Agents with full administrative access to this workspace.',
      agentIds: [], permissions: {}, createdAt: now,
    });
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

  // Only the owner or platform admin (master key, no identity) can update settings
  const identity = uid ?? agentId;
  if (identity) {
    const userDoc = await db().collection('users').doc(identity).get();
    const membership = userDoc.data()?.workspaces?.[wsId];
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      res.status(403).json({ error: 'Only workspace owner or admin can update settings' }); return;
    }
  }

  const { name } = req.body;
  const update: Record<string, unknown> = {};
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'name must be a non-empty string' }); return;
    }
    update.name = name.trim();
  }
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: 'No fields to update' }); return;
  }

  await db().collection('workspaces').doc(wsId).update(update);
  res.json({ ok: true });
}));

// --- Invite / add member ---

workspacesRouter.post('/:id/members', requireRole('admin'), wrap(async (req, res) => {
  const { uid: callerUid, agentId: callerAgentId } = req.auth!;
  const wsId = req.params.id as string;
  // Accept either uid (Firebase user) or agentId (pure agent) as the invitee identity
  const { uid: inviteeUid, agentId: inviteeAgentId, role = 'viewer' } = req.body;
  const inviteeIdentity = inviteeUid ?? inviteeAgentId;

  if (!inviteeIdentity || typeof inviteeIdentity !== 'string') {
    res.status(400).json({ error: 'uid or agentId is required' }); return;
  }
  if (!VALID_MEMBER_ROLES.includes(role)) {
    res.status(400).json({ error: `role must be one of: ${VALID_MEMBER_ROLES.join(', ')}` }); return;
  }

  const wsDoc = await db().collection('workspaces').doc(wsId).get();
  if (!wsDoc.exists) { res.status(404).json({ error: 'Workspace not found' }); return; }

  // Only owner/admin can invite
  const callerIdentity = callerUid ?? callerAgentId;
  if (callerIdentity) {
    const callerDoc = await db().collection('users').doc(callerIdentity).get();
    const membership = callerDoc.data()?.workspaces?.[wsId];
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      res.status(403).json({ error: 'Only workspace owner or admin can invite members' }); return;
    }
  }

  const now = FieldValue.serverTimestamp();
  await db().collection('users').doc(inviteeIdentity).set({
    workspaces: { [wsId]: { role, joinedAt: now } },
  }, { merge: true });

  res.status(201).json({ ok: true, workspaceId: wsId, identity: inviteeIdentity, role });
}));

// --- Join (disabled: all workspaces are invite-only) ---

workspacesRouter.post('/:id/join', requireIdentity, wrap(async (_req, res) => {
  res.status(403).json({ error: 'This workspace is invite-only' });
}));

// --- Remove member ---

workspacesRouter.delete('/:id/members/:identity', requireRole('admin'), wrap(async (req, res) => {
  const { uid: callerUid, agentId: callerAgentId } = req.auth!;
  const wsId = req.params.id as string;
  // The :identity param is either a Firebase uid or an agentId
  const targetIdentity = req.params.identity as string;

  const wsDoc = await db().collection('workspaces').doc(wsId).get();
  if (!wsDoc.exists) { res.status(404).json({ error: 'Workspace not found' }); return; }

  const callerIdentity = callerUid ?? callerAgentId;
  if (callerIdentity) {
    const callerDoc = await db().collection('users').doc(callerIdentity).get();
    const membership = callerDoc.data()?.workspaces?.[wsId];
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      res.status(403).json({ error: 'Only workspace owner or admin can remove members' }); return;
    }
  }

  await db().collection('users').doc(targetIdentity).update({
    [`workspaces.${wsId}`]: FieldValue.delete(),
  });

  res.status(204).send();
}));
