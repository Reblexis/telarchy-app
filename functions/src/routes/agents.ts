import { Router } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/db';
import { randomBytes } from 'crypto';
import { wrap } from '../lib/wrap';
import { hashKey, authMiddleware } from '../middleware/auth';
import { requireRole, requireSelfOrAdmin } from '../middleware/roles';

export const agentsRouter = Router();

// --- Registration (no auth) ---

agentsRouter.post('/register', wrap(async (req, res) => {
  const { agentId } = req.body;
  if (!agentId || typeof agentId !== 'string') {
    res.status(400).json({ error: 'agentId is required' }); return;
  }

  const agentRef = db().collection('agents').doc(agentId);
  const existing = await agentRef.get();
  if (existing.exists) {
    res.status(409).json({ error: 'Agent already registered' }); return;
  }

  const rawKey = randomBytes(32).toString('hex');
  const keyHash = hashKey(rawKey);

  const batch = db().batch();
  batch.set(agentRef, {
    id: agentId,
    apiKeyHash: keyHash,
    role: 'pending',
    balance: 0,
    gifted: 0,
    earnedBetting: 0,
    spentBetting: 0,
    spentTokens: 0,
    createdAt: FieldValue.serverTimestamp(),
    approvedAt: null,
  });
  batch.set(db().collection('agentApiKeys').doc(keyHash), { agentId });
  await batch.commit();

  res.status(201).json({ agentId, apiKey: rawKey });
}));

// --- All routes below require auth ---

agentsRouter.use(authMiddleware);

// --- Agent-accessible (self or admin) ---

agentsRouter.get('/:id', requireSelfOrAdmin, wrap(async (req, res) => {
  const id = req.params.id as string;
  const doc = await db().collection('agents').doc(id).get();
  if (!doc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }
  const { apiKeyHash, ...agent } = doc.data()!;
  res.json(agent);
}));

agentsRouter.get('/:id/balance', requireSelfOrAdmin, wrap(async (req, res) => {
  const id = req.params.id as string;
  const doc = await db().collection('agents').doc(id).get();
  if (!doc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }
  res.json({ balance: doc.data()!.balance });
}));

// --- Admin-only ---

agentsRouter.get('/', requireRole('admin'), wrap(async (_req, res) => {
  // Auto-create "user" agent if missing
  const userRef = db().collection('agents').doc('user');
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    const now = Timestamp.now();
    await userRef.set({
      id: 'user',
      apiKeyHash: '__user__',
      role: 'admin',
      balance: 999999999,
      gifted: 0,
      earnedBetting: 0,
      spentBetting: 0,
      spentTokens: 0,
      createdAt: now,
      approvedAt: now,
    });
  }

  const snapshot = await db().collection('agents').orderBy('createdAt', 'desc').get();
  const agents = snapshot.docs.map(doc => {
    const { apiKeyHash, ...data } = doc.data();
    return data;
  });
  res.json(agents);
}));

agentsRouter.put('/:id/approve', requireRole('admin'), wrap(async (req, res) => {
  const id = req.params.id as string;
  const ref = db().collection('agents').doc(id);
  const doc = await ref.get();
  if (!doc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }

  await ref.update({
    role: 'agent',
    approvedAt: FieldValue.serverTimestamp(),
  });
  res.json({ ok: true });
}));

agentsRouter.put('/:id/role', requireRole('admin'), wrap(async (req, res) => {
  const { role } = req.body;
  if (!role || !['admin', 'agent', 'pending'].includes(role)) {
    res.status(400).json({ error: 'Invalid role' }); return;
  }
  const id = req.params.id as string;
  const ref = db().collection('agents').doc(id);
  const doc = await ref.get();
  if (!doc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }

  await ref.update({ role });
  res.json({ ok: true });
}));

agentsRouter.post('/:id/credit', requireRole('admin'), wrap(async (req, res) => {
  const { amount, reason, fromAgentId } = req.body;
  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' }); return;
  }
  const id = req.params.id as string;
  const ref = db().collection('agents').doc(id);
  const doc = await ref.get();
  if (!doc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }

  if (fromAgentId && fromAgentId !== id) {
    const fromRef = db().collection('agents').doc(fromAgentId);
    const fromDoc = await fromRef.get();
    if (!fromDoc.exists) { res.status(404).json({ error: 'Source agent not found' }); return; }
    const fromBalance = fromDoc.data()!.balance as number;
    if (fromBalance < amount) {
      res.status(400).json({ error: 'Insufficient balance on source agent', balance: fromBalance }); return;
    }
    const batch = db().batch();
    batch.update(fromRef, { balance: FieldValue.increment(-amount) });
    batch.update(ref, { balance: FieldValue.increment(amount), gifted: FieldValue.increment(amount) });
    await batch.commit();
  } else {
    await ref.update({
      balance: FieldValue.increment(amount),
      gifted: FieldValue.increment(amount),
    });
  }
  res.json({ ok: true, credited: amount, reason: reason || '', from: fromAgentId || null });
}));

agentsRouter.post('/:id/spend', requireRole('admin'), wrap(async (req, res) => {
  const { amount, reason, type } = req.body;
  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' }); return;
  }
  if (!type || !['betting', 'tokens'].includes(type)) {
    res.status(400).json({ error: 'type must be "betting" or "tokens"' }); return;
  }
  const id = req.params.id as string;
  const ref = db().collection('agents').doc(id);
  const doc = await ref.get();
  if (!doc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }

  const current = doc.data()!.balance as number;
  if (current < amount) {
    res.status(400).json({ error: 'Insufficient balance', balance: current }); return;
  }

  const field = type === 'betting' ? 'spentBetting' : 'spentTokens';
  await ref.update({
    balance: FieldValue.increment(-amount),
    [field]: FieldValue.increment(amount),
  });
  res.json({ ok: true, spent: amount, type, reason: reason || '' });
}));

agentsRouter.delete('/:id', requireRole('admin'), wrap(async (req, res) => {
  const id = req.params.id as string;
  const ref = db().collection('agents').doc(id);
  const doc = await ref.get();
  if (!doc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }

  const { apiKeyHash } = doc.data()!;
  const batch = db().batch();
  batch.delete(ref);
  batch.delete(db().collection('agentApiKeys').doc(apiKeyHash));
  await batch.commit();

  res.status(204).send();
}));
