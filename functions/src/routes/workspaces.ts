import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../lib/db';
import { wrap } from '../lib/wrap';
import { requireRole, requireFirebaseUser } from '../middleware/roles';
import type { WorkspaceMemberRole } from '../types';

export const workspacesRouter = Router();

const VALID_MEMBER_ROLES: WorkspaceMemberRole[] = ['owner', 'admin', 'trader', 'viewer'];

// --- Create workspace ---

workspacesRouter.post('/', requireFirebaseUser, wrap(async (req, res) => {
  const { uid } = req.auth!;
  if (!uid) { res.status(403).json({ error: 'Firebase account required to create a workspace' }); return; }

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
      createdBy: uid,
      createdAt: now,
      visibility: 'private',
    });
    // Record membership in the user profile
    tx.set(db().collection('users').doc(uid), {
      workspaces: { [wsRef.id]: { role: 'owner', joinedAt: now } },
    }, { merge: true });
  });

  res.status(201).json({ id: wsRef.id, name: name.trim(), visibility: 'private' });
}));

// --- List workspaces the current user belongs to ---

workspacesRouter.get('/', requireFirebaseUser, wrap(async (req, res) => {
  const { uid } = req.auth!;
  if (!uid) {
    // Master API key: return all workspaces
    const snap = await db().collection('workspaces').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    return;
  }

  const userDoc = await db().collection('users').doc(uid).get();
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

// --- Get workspace detail ---

workspacesRouter.get('/:id', requireFirebaseUser, wrap(async (req, res) => {
  const wsId = req.params.id as string;
  const doc = await db().collection('workspaces').doc(wsId).get();
  if (!doc.exists) { res.status(404).json({ error: 'Workspace not found' }); return; }
  res.json({ id: doc.id, ...doc.data() });
}));

// --- Update workspace settings ---

workspacesRouter.put('/:id/settings', requireRole('admin'), wrap(async (req, res) => {
  const { uid } = req.auth!;
  const wsId = req.params.id as string;

  const wsDoc = await db().collection('workspaces').doc(wsId).get();
  if (!wsDoc.exists) { res.status(404).json({ error: 'Workspace not found' }); return; }

  // Only the owner or platform admin (master key, no uid) can update settings
  if (uid) {
    const userDoc = await db().collection('users').doc(uid).get();
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
  const { uid: callerUid } = req.auth!;
  const wsId = req.params.id as string;
  const { uid: inviteeUid, role = 'viewer' } = req.body;

  if (!inviteeUid || typeof inviteeUid !== 'string') {
    res.status(400).json({ error: 'uid is required' }); return;
  }
  if (!VALID_MEMBER_ROLES.includes(role)) {
    res.status(400).json({ error: `role must be one of: ${VALID_MEMBER_ROLES.join(', ')}` }); return;
  }

  const wsDoc = await db().collection('workspaces').doc(wsId).get();
  if (!wsDoc.exists) { res.status(404).json({ error: 'Workspace not found' }); return; }

  // Only owner/admin can invite
  if (callerUid) {
    const callerDoc = await db().collection('users').doc(callerUid).get();
    const membership = callerDoc.data()?.workspaces?.[wsId];
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      res.status(403).json({ error: 'Only workspace owner or admin can invite members' }); return;
    }
  }

  const now = FieldValue.serverTimestamp();
  await db().collection('users').doc(inviteeUid).set({
    workspaces: { [wsId]: { role, joinedAt: now } },
  }, { merge: true });

  res.status(201).json({ ok: true, workspaceId: wsId, uid: inviteeUid, role });
}));

// --- Join (disabled: all workspaces are invite-only) ---

workspacesRouter.post('/:id/join', requireFirebaseUser, wrap(async (_req, res) => {
  res.status(403).json({ error: 'This workspace is invite-only' });
}));

// --- Remove member ---

workspacesRouter.delete('/:id/members/:uid', requireRole('admin'), wrap(async (req, res) => {
  const { uid: callerUid } = req.auth!;
  const wsId = req.params.id as string;
  const targetUid = req.params.uid as string;

  const wsDoc = await db().collection('workspaces').doc(wsId).get();
  if (!wsDoc.exists) { res.status(404).json({ error: 'Workspace not found' }); return; }

  if (callerUid) {
    const callerDoc = await db().collection('users').doc(callerUid).get();
    const membership = callerDoc.data()?.workspaces?.[wsId];
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      res.status(403).json({ error: 'Only workspace owner or admin can remove members' }); return;
    }
  }

  await db().collection('users').doc(targetUid).update({
    [`workspaces.${wsId}`]: FieldValue.delete(),
  });

  res.status(204).send();
}));
