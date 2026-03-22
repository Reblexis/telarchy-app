import { Router } from 'express';
import { randomBytes } from 'crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../lib/db';
import { wrap } from '../lib/wrap';
import { requireFirebaseUser } from '../middleware/roles';
import { hashKey } from '../middleware/auth';

export const userauthRouter = Router();

/**
 * GET /api/auth/me
 * Returns the current user's profile and workspace memberships.
 * Works for both Firebase users (uid set) and master API key (uid undefined).
 */
userauthRouter.get('/me', requireFirebaseUser, wrap(async (req, res) => {
  const { uid, workspaceId, role: authRole } = req.auth!;

  if (!uid) {
    // Master API key — return a synthetic profile
    res.json({ uid: null, email: null, workspaceId, authRole, workspaces: {} });
    return;
  }

  const userDoc = await db().collection('users').doc(uid).get();
  if (!userDoc.exists) {
    res.json({ uid, email: null, intent: null, workspaceId, authRole, memberRole: null, workspaces: {} });
    return;
  }

  const data = userDoc.data()!;
  const workspaces = (data.workspaces ?? {}) as Record<string, { role: string }>;
  const memberRole = workspaces[workspaceId]?.role ?? null;
  res.json({
    uid,
    email: data.email ?? null,
    intent: (data.intent as 'creator' | 'agent') ?? null,
    workspaceId,
    authRole,   // 'admin' | 'agent' | 'pending' — derived from workspace membership
    memberRole, // 'owner' | 'admin' | 'trader' | 'viewer' | null
    workspaces,
  });
}));

/**
 * POST /api/auth/profile
 * Upserts the current user's profile. Auto-creates a linked agent on first call.
 * Returns { ok, agentId, apiKey? } — apiKey is only present on first creation.
 */
userauthRouter.post('/profile', requireFirebaseUser, wrap(async (req, res) => {
  const { uid } = req.auth!;
  if (!uid) { res.status(403).json({ error: 'Firebase account required' }); return; }

  const { email, intent } = req.body;
  if (email !== undefined && typeof email !== 'string') {
    res.status(400).json({ error: 'email must be a string' }); return;
  }
  if (intent !== undefined && !['creator', 'agent'].includes(intent)) {
    res.status(400).json({ error: 'intent must be "creator" or "agent"' }); return;
  }

  const update: Record<string, unknown> = {};
  if (email !== undefined) update.email = email;
  if (intent !== undefined) update.intent = intent;

  // Auto-create agent on first signup if not already linked
  const userRef = db().collection('users').doc(uid);
  const userDoc = await userRef.get();
  const existingAgentId = userDoc.exists ? (userDoc.data()!.agentId as string | undefined) : undefined;

  let agentId: string;
  let apiKey: string | undefined;

  if (existingAgentId) {
    agentId = existingAgentId;
  } else {
    // Derive agentId from Firebase UID (lowercase, alphanumeric only)
    const candidateId = uid.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 28);
    agentId = candidateId || `u${uid.slice(0, 20)}`;

    const agentRef = db().collection('agents').doc(agentId);
    const agentDoc = await agentRef.get();

    if (agentDoc.exists && (agentDoc.data()!.ownerUid as string | undefined) === uid) {
      // Agent already exists for this uid (e.g. registered manually before) — just link it
    } else if (!agentDoc.exists) {
      const rawKey = randomBytes(32).toString('hex');
      const keyHash = hashKey(rawKey);
      apiKey = rawKey;

      const batch = db().batch();
      batch.set(agentRef, {
        id: agentId,
        apiKeyHash: keyHash,
        role: 'agent',
        balance: 0,
        earnedBetting: 0,
        spentBetting: 0,
        spentTokens: 0,
        ownerUid: uid,
        createdAt: FieldValue.serverTimestamp(),
        approvedAt: FieldValue.serverTimestamp(),
      });
      batch.set(db().collection('agentApiKeys').doc(keyHash), { agentId, workspaceId: 'default' });
      await batch.commit();
    } else {
      // ID collision with an unrelated agent — append uid suffix
      agentId = `${candidateId.slice(0, 20)}${uid.slice(-6).toLowerCase()}`;
      const rawKey = randomBytes(32).toString('hex');
      const keyHash = hashKey(rawKey);
      apiKey = rawKey;

      const batch = db().batch();
      batch.set(db().collection('agents').doc(agentId), {
        id: agentId,
        apiKeyHash: keyHash,
        role: 'agent',
        balance: 0,
        earnedBetting: 0,
        spentBetting: 0,
        spentTokens: 0,
        ownerUid: uid,
        createdAt: FieldValue.serverTimestamp(),
        approvedAt: FieldValue.serverTimestamp(),
      });
      batch.set(db().collection('agentApiKeys').doc(keyHash), { agentId, workspaceId: 'default' });
      await batch.commit();
    }

    update.agentId = agentId;
  }

  await userRef.set(update, { merge: true });
  res.json({ ok: true, agentId, ...(apiKey !== undefined && { apiKey }) });
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
