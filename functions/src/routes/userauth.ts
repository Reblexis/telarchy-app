import { Router } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { db } from '../lib/db';
import { wrap } from '../lib/wrap';
import { requireFirebaseUser } from '../middleware/roles';

export const userauthRouter = Router();

/**
 * GET /api/auth/me
 * Returns the current user's profile and workspace memberships.
 * Works for both Firebase users (uid set) and master API key (uid undefined).
 */
userauthRouter.get('/me', requireFirebaseUser, wrap(async (req, res) => {
  const { uid, workspaceId } = req.auth!;

  if (!uid) {
    // Master API key — return a synthetic profile
    res.json({ uid: null, email: null, workspaceId, workspaces: {} });
    return;
  }

  const userDoc = await db().collection('users').doc(uid).get();
  if (!userDoc.exists) {
    res.json({ uid, email: null, workspaceId, workspaces: {} });
    return;
  }

  const data = userDoc.data()!;
  const workspaces = (data.workspaces ?? {}) as Record<string, { role: string }>;
  const memberRole = workspaces[workspaceId]?.role ?? null;
  res.json({
    uid,
    email: data.email ?? null,
    workspaceId,
    memberRole,
    workspaces,
  });
}));

/**
 * POST /api/auth/profile
 * Upserts the current user's profile (email, display name).
 * Called after a Firebase user signs in for the first time.
 */
userauthRouter.post('/profile', requireFirebaseUser, wrap(async (req, res) => {
  const { uid } = req.auth!;
  if (!uid) { res.status(403).json({ error: 'Firebase account required' }); return; }

  const { email } = req.body;
  if (email !== undefined && typeof email !== 'string') {
    res.status(400).json({ error: 'email must be a string' }); return;
  }

  const update: Record<string, unknown> = {};
  if (email !== undefined) update.email = email;

  await db().collection('users').doc(uid).set(update, { merge: true });
  res.json({ ok: true });
}));

/**
 * DELETE /api/auth/me
 * GDPR: deletes the user's Firestore profile document and Firebase Auth account.
 * Does NOT delete workspace data (positions, trades etc.) — those are anonymized.
 */
userauthRouter.delete('/me', requireFirebaseUser, wrap(async (req, res) => {
  const { uid } = req.auth!;
  if (!uid) { res.status(403).json({ error: 'Firebase account required' }); return; }

  await db().collection('users').doc(uid).delete();
  await getAuth().deleteUser(uid);

  res.status(204).send();
}));

/**
 * GET /api/auth/me/export
 * GDPR: exports all data associated with the current user.
 */
userauthRouter.get('/me/export', requireFirebaseUser, wrap(async (req, res) => {
  const { uid } = req.auth!;
  if (!uid) { res.status(403).json({ error: 'Firebase account required' }); return; }

  const userDoc = await db().collection('users').doc(uid).get();
  res.json({
    uid,
    profile: userDoc.exists ? userDoc.data() : null,
    exportedAt: new Date().toISOString(),
  });
}));
