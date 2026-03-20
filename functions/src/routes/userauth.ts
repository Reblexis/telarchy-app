import { Router } from 'express';
import { db } from '../lib/db';
import { wrap } from '../lib/wrap';
import { requireRole } from '../middleware/roles';

export const userauthRouter = Router();

/**
 * GET /api/auth/me
 * Returns the current user's profile and workspace memberships.
 * Works for both Firebase users (uid set) and master API key (uid undefined).
 */
userauthRouter.get('/me', requireRole('admin'), wrap(async (req, res) => {
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
  res.json({
    uid,
    email: data.email ?? null,
    workspaceId,
    workspaces: data.workspaces ?? {},
  });
}));

/**
 * POST /api/auth/profile
 * Upserts the current user's profile (email, display name).
 * Called after a Firebase user signs in for the first time.
 */
userauthRouter.post('/profile', requireRole('admin'), wrap(async (req, res) => {
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
