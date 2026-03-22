import { Router } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/db';
import { wsCol } from '../lib/workspace';
import { randomBytes } from 'crypto';
import { wrap } from '../lib/wrap';
import { hashKey, authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { requireRole, requireSelfOrAdmin, requireIdentity } from '../middleware/roles';
import { getMarkets } from '../services/predictions';
import { sendUsdc, getTreasuryBalances, getTreasuryAddress, validateWalletAddress, verifyUsdcDeposit } from '../lib/usdc';
import { AppError } from '../lib/errors';
import { validateAgentId, validateTxHash, sufficientBalance, toUnits, fromUnits, CREDIT_PRECISION } from '../lib/validation';

export const agentsRouter = Router();

// --- Registration (optional auth — links agent to Firebase user if token present) ---

agentsRouter.post('/register', optionalAuthMiddleware, wrap(async (req, res) => {
  const { agentId, workspaceId = 'default' } = req.body;
  const agentIdError = validateAgentId(agentId);
  if (agentIdError) { res.status(400).json({ error: agentIdError }); return; }

  const agentRef = db().collection('agents').doc(agentId);
  const existing = await agentRef.get();
  if (existing.exists) {
    res.status(409).json({ error: 'Agent already registered' }); return;
  }

  const rawKey = randomBytes(32).toString('hex');
  const keyHash = hashKey(rawKey);
  const ownerUid = req.auth?.uid ?? null;

  const batch = db().batch();
  batch.set(agentRef, {
    id: agentId,
    apiKeyHash: keyHash,
    role: 'agent',
    balance: 0,
    earnedBetting: 0,
    spentBetting: 0,
    spentTokens: 0,
    ownerUid,
    createdAt: FieldValue.serverTimestamp(),
    approvedAt: FieldValue.serverTimestamp(),
  });
  batch.set(db().collection('agentApiKeys').doc(keyHash), { agentId, workspaceId });
  await batch.commit();

  // Auto-add to the workspace Public group (best-effort, outside the batch since it requires a query)
  const pubSnap = await wsCol(workspaceId, 'permissionGroups').where('type', '==', 'public').limit(1).get();
  if (!pubSnap.empty) {
    await pubSnap.docs[0].ref.update({ agentIds: FieldValue.arrayUnion(agentId) });
  }

  res.status(201).json({ agentId, apiKey: rawKey });
}));

// --- My agents ---
// Firebase user: returns all agents they own (ownerUid == uid)
// Agent key auth: returns just the authenticated agent itself

agentsRouter.get('/mine', authMiddleware, requireIdentity, wrap(async (req, res) => {
  const { uid, agentId } = req.auth!;

  if (uid) {
    const snap = await db().collection('agents').where('ownerUid', '==', uid).orderBy('createdAt', 'desc').get();
    res.json(snap.docs.map(doc => {
      const { apiKeyHash, ...data } = doc.data();
      return { ...data, balance: fromUnits(data.balance as number) };
    }));
  } else {
    const doc = await db().collection('agents').doc(agentId!).get();
    if (!doc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }
    const { apiKeyHash, ...data } = doc.data()!;
    res.json([{ ...data, balance: fromUnits(data.balance as number) }]);
  }
}));

// --- All routes below require auth ---

agentsRouter.use(authMiddleware);

// Returns treasury USDC balance and address on Base. Platform admin only.
// Must be before /:id to avoid "treasury" being matched as an agent id.
agentsRouter.get('/treasury', requireRole('admin'), wrap(async (req, res) => {
  if (req.auth!.workspaceId !== 'default') {
    res.status(403).json({ error: 'Treasury is only accessible to platform admin' }); return;
  }
  res.json(await getTreasuryBalances());
}));

// --- Agent-accessible (self or admin) ---

agentsRouter.get('/:id', requireSelfOrAdmin, wrap(async (req, res) => {
  const id = req.params.id as string;
  const doc = await db().collection('agents').doc(id).get();
  if (!doc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }
  const { apiKeyHash, ...agent } = doc.data()!;
  res.json({ ...agent, balance: fromUnits(agent.balance as number) });
}));

agentsRouter.get('/:id/balance', requireSelfOrAdmin, wrap(async (req, res) => {
  const id = req.params.id as string;
  const doc = await db().collection('agents').doc(id).get();
  if (!doc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }
  res.json({ balance: fromUnits(doc.data()!.balance as number) });
}));

// Returns a compact summary useful for an agent's startup: balance + top liquid markets.
// Replaces separate balance + markets calls with one low-token response.
agentsRouter.get('/:id/dashboard', requireSelfOrAdmin, wrap(async (req, res) => {
  const id = req.params.id as string;
  const { workspaceId } = req.auth!;
  const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 10;

  const [agentDoc, markets] = await Promise.all([
    db().collection('agents').doc(id).get(),
    getMarkets({ active: true, minLiquidity: 0.01, limit }, undefined, workspaceId),
  ]);

  if (!agentDoc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }

  res.json({
    balance: fromUnits(agentDoc.data()!.balance as number),
    markets,
  });
}));

// --- Admin-only ---

agentsRouter.get('/', requireRole('admin'), wrap(async (_req, res) => {
  // Auto-create "user" agent if missing (balance starts at 0 — credits must be USDC-backed)
  const userRef = db().collection('agents').doc('user');
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    const now = Timestamp.now();
    await userRef.set({
      id: 'user',
      apiKeyHash: '__user__',
      role: 'admin',
      balance: 0,
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
    return { ...data, balance: fromUnits(data.balance as number) };
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
  if (!sufficientBalance(current, amount)) {
    res.status(400).json({ error: 'Insufficient balance', balance: fromUnits(current) }); return;
  }

  const field = type === 'betting' ? 'spentBetting' : 'spentTokens';
  await ref.update({
    balance: FieldValue.increment(-toUnits(amount)),
    [field]: FieldValue.increment(amount),
  });
  res.json({ ok: true, spent: amount, type, reason: reason || '' });
}));

// --- USDC deposit → credits ---

// Anyone can purchase credits by sending USDC to the treasury on Base, then calling this endpoint.
// Credits issued = floor(usdcAmount / (creditValueUsd * (1 + buyFeePercent/100))).
// The fee stays in the treasury as surplus, ensuring withdrawals are always fully backed.
// Body: { txHash: string } — the on-chain tx hash of the USDC transfer to the treasury.
agentsRouter.post('/:id/deposit', requireSelfOrAdmin, wrap(async (req, res) => {
  const id = req.params.id as string;
  const { txHash } = req.body;
  const txHashError = validateTxHash(txHash);
  if (txHashError) { res.status(400).json({ error: txHashError }); return; }

  const agentRef = db().collection('agents').doc(id);
  const agentDoc = await agentRef.get();
  if (!agentDoc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }

  // Deduplicate: each tx hash can only be used once across the whole system.
  const depositRef = db().collection('deposits').doc(txHash);
  const existing = await depositRef.get();
  if (existing.exists) {
    res.status(409).json({ error: 'This transaction has already been used to purchase credits' }); return;
  }

  const economyDoc = await db().collection('_system').doc('economy').get();
  const economy = economyDoc.exists ? economyDoc.data()! : {};
  const creditValueUsd: number = economy.creditValueUsd ?? 1;
  const buyFeePercent: number = economy.buyFeePercent ?? 0;
  const buyRate = creditValueUsd * (1 + buyFeePercent / 100); // USDC cost per credit

  const { usdcAmount, from } = await verifyUsdcDeposit(txHash);
  const credits = Math.floor(usdcAmount / buyRate);

  if (credits <= 0) {
    res.status(400).json({ error: `Deposit too small. Minimum: ${buyRate.toFixed(6)} USDC for 1 credit` }); return;
  }

  const batch = db().batch();
  batch.set(depositRef, {
    txHash,
    agentId: id,
    from,
    usdcAmount,
    credits,
    buyRate,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.update(agentRef, {
    balance: FieldValue.increment(toUnits(credits)),
  });
  await batch.commit();

  res.status(201).json({ ok: true, usdcAmount, credits, buyRate, from });
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
    if (!sufficientBalance(data.balance as number, amount)) {
      throw new AppError(`Insufficient balance (have ${fromUnits(data.balance as number)}, need ${amount})`, 400);
    }

    walletAddress = data.walletAddress as string;
    tx.update(ref, { balance: FieldValue.increment(-toUnits(amount)) });
  });

  const usdcAmount = Math.round(amount * creditValueUsd * 1e6) / 1e6; // 6 decimal precision

  let txHash: string;
  try {
    txHash = await sendUsdc(walletAddress!, usdcAmount);
  } catch (err) {
    // Re-credit on tx failure so the balance remains consistent.
    await db().collection('agents').doc(id).update({ balance: FieldValue.increment(toUnits(amount)) });
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

// One-time migration: convert all agent balances from float credits to integer nanocredits (×1e9).
// Safe to call multiple times — skips agents whose balance is already in nanocredit format.
// Detection: balances >= CREDIT_PRECISION are assumed already migrated (represent ≥1 credit in nanocredits).
// Balances above 1,000,000 credits are capped to toUnits(1_000_000) to avoid integer overflow.
agentsRouter.post('/migrate-balances-to-units', requireRole('admin'), wrap(async (_req, res) => {
  const snap = await db().collection('agents').get();
  const batch = db().batch();
  let converted = 0;
  let skipped = 0;
  for (const doc of snap.docs) {
    const balance = doc.data().balance as number;
    if (Number.isInteger(balance) && balance >= CREDIT_PRECISION) { skipped++; continue; }
    const credits = Math.min(balance, 1_000_000); // cap to avoid MAX_SAFE_INTEGER overflow
    batch.update(doc.ref, { balance: toUnits(credits) });
    converted++;
  }
  if (converted > 0) await batch.commit();
  res.json({ converted, skipped });
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
