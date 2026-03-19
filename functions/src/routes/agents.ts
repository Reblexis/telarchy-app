import { Router } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/db';
import { randomBytes } from 'crypto';
import { wrap } from '../lib/wrap';
import { hashKey, authMiddleware } from '../middleware/auth';
import { requireRole, requireSelfOrAdmin } from '../middleware/roles';
import { getMarkets } from '../services/predictions';
import { sendUsdc, getTreasuryUsdcBalance, getTreasuryAddress, validateWalletAddress } from '../lib/usdc';
import { AppError } from '../lib/errors';

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

// Returns a compact summary useful for an agent's startup: balance + top liquid markets.
// Replaces separate balance + markets calls with one low-token response.
agentsRouter.get('/:id/dashboard', requireSelfOrAdmin, wrap(async (req, res) => {
  const id = req.params.id as string;
  const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 10;

  const [agentDoc, markets] = await Promise.all([
    db().collection('agents').doc(id).get(),
    getMarkets({ active: true, minLiquidity: 0.01, limit }),
  ]);

  if (!agentDoc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }

  res.json({
    balance: agentDoc.data()!.balance,
    markets,
  });
}));

// Returns treasury USDC balance and address on Base. Admin only.
// Must be declared before /:id routes to avoid "treasury" being treated as an id.
agentsRouter.get('/treasury', requireRole('admin'), wrap(async (_req, res) => {
  const [balance, address] = await Promise.all([
    getTreasuryUsdcBalance(),
    Promise.resolve(getTreasuryAddress()),
  ]);
  res.json({ address, usdcBalance: balance });
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

// Agents can spend their own credits (e.g. voluntarily buying tokens or any other service).
// Admin can spend on behalf of any agent. type='betting' is reserved for admin use only.
agentsRouter.post('/:id/spend', requireSelfOrAdmin, wrap(async (req, res) => {
  const { amount, reason, type } = req.body;
  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' }); return;
  }
  const validTypes = ['betting', 'tokens', 'purchase'];
  if (!type || !validTypes.includes(type)) {
    res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` }); return;
  }
  if (type === 'betting' && req.auth!.role !== 'admin') {
    res.status(403).json({ error: 'type "betting" is reserved for admin use' }); return;
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

// --- Wallet & USDC withdrawal ---

// Register or update an agent's Base wallet address for USDC withdrawals.
agentsRouter.put('/:id/wallet', requireSelfOrAdmin, wrap(async (req, res) => {
  const id = req.params.id as string;
  const { walletAddress } = req.body;
  if (!walletAddress || typeof walletAddress !== 'string') {
    res.status(400).json({ error: 'walletAddress is required' }); return;
  }
  const checksummed = validateWalletAddress(walletAddress);
  const ref = db().collection('agents').doc(id);
  const doc = await ref.get();
  if (!doc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }

  await ref.update({ walletAddress: checksummed });
  res.json({ ok: true, walletAddress: checksummed });
}));

// Withdraw credits as USDC on Base. Converts at current creditValueUsd rate.
// Body: { amount: number } — credits to withdraw.
agentsRouter.post('/:id/withdraw', requireSelfOrAdmin, wrap(async (req, res) => {
  const id = req.params.id as string;
  const { amount } = req.body;
  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' }); return;
  }

  const economyDoc = await db().collection('_system').doc('economy').get();
  const creditValueUsd: number | null = economyDoc.exists ? (economyDoc.data()!.creditValueUsd ?? null) : null;
  if (!creditValueUsd) throw new AppError('creditValueUsd is not configured in _system/economy', 500);

  // Atomically deduct the balance, failing early if insufficient.
  let walletAddress: string;
  await db().runTransaction(async (tx) => {
    const ref = db().collection('agents').doc(id);
    const doc = await tx.get(ref);
    if (!doc.exists) throw new AppError('Agent not found', 404);

    const data = doc.data()!;
    if (!data.walletAddress) throw new AppError('Agent has no registered wallet address', 400);
    if ((data.balance as number) < amount) {
      throw new AppError(`Insufficient balance (have ${data.balance}, need ${amount})`, 400);
    }

    walletAddress = data.walletAddress as string;
    tx.update(ref, { balance: FieldValue.increment(-amount) });
  });

  const usdcAmount = Math.round(amount * creditValueUsd * 1e6) / 1e6; // 6 decimal precision

  let txHash: string;
  try {
    txHash = await sendUsdc(walletAddress!, usdcAmount);
  } catch (err) {
    // Re-credit on tx failure so the balance remains consistent.
    await db().collection('agents').doc(id).update({ balance: FieldValue.increment(amount) });
    console.error(`[withdraw] USDC send failed for agent ${id}, re-credited ${amount} credits:`, err);
    throw new AppError('On-chain transfer failed; credits have been restored', 502);
  }

  const withdrawalRef = db().collection('withdrawals').doc();
  await Promise.all([
    withdrawalRef.set({
      id: withdrawalRef.id,
      agentId: id,
      credits: amount,
      usdcAmount,
      toAddress: walletAddress!,
      txHash,
      createdAt: FieldValue.serverTimestamp(),
    }),
    db().collection('agents').doc(id).update({
      withdrawnUsdc: FieldValue.increment(usdcAmount),
    }),
  ]);

  res.json({ ok: true, credits: amount, usdcAmount, txHash, toAddress: walletAddress! });
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
