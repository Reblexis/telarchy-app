import { Router, type Request } from 'express';
import { db } from '../db/client';
import { agents, agentApiKeys, deposits, withdrawals, systemConfig, workspaces } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { randomUUID } from 'crypto';
import { wrap } from '../lib/wrap';
import { hashKey, authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { requireRole, requireSelfOrAdmin, requireIdentity } from '../middleware/roles';
import { getMarkets } from '../services/predictions';
import {
  sendUsdc,
  getTreasuryBalances,
  getTreasuryAddress,
  validateWalletAddress,
  verifyUsdcDeposit,
  USDC_ON_BASE_MAINNET,
} from '../lib/usdc';
import { AppError } from '../lib/errors';
import { creditsIssuedForUsdcDeposit, depositBuyRateUsd } from '../lib/economy';
import { validateAgentId, validateTxHash, sufficientBalance, toUnits, fromUnits } from '../lib/validation';
import { listParticipantsForWorkspace } from '../lib/participants';
import { isUsdcSettlementEnabled } from '../lib/settlement';

export const agentsRouter = Router();

const USDC_DISABLED_MESSAGE =
  'USDC settlement is disabled on this instance. Credits on this instance are for simulation and have no redemption value.';

function requireUsdcEnabled(res: import('express').Response): boolean {
  if (isUsdcSettlementEnabled()) return true;
  res.status(503).json({ error: USDC_DISABLED_MESSAGE });
  return false;
}

function resolveRouteAgentId(req: Request): string | null {
  if ((req.params.id as string) === 'me') return req.auth?.agentId ?? null;
  return req.params.id as string;
}

agentsRouter.post('/register', optionalAuthMiddleware, wrap(async (req, res) => {
  const { agentId, workspaceId } = req.body;
  const agentIdError = validateAgentId(agentId);
  if (agentIdError) { res.status(400).json({ error: agentIdError }); return; }

  if (!workspaceId || typeof workspaceId !== 'string') {
    res.status(400).json({ error: 'workspaceId is required' }); return;
  }

  const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }

  const [existing] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (existing) { res.status(409).json({ error: 'Agent already registered' }); return; }

  const rawKey = randomBytes(32).toString('hex');
  const keyHash = hashKey(rawKey);

  await db.transaction(async tx => {
    await tx.insert(agents).values({
      id: agentId, apiKeyHash: keyHash, role: 'agent', balance: 0,
      authUserId: req.auth?.uid ?? null, createdAt: new Date(), approvedAt: new Date(),
    });
    await tx.insert(agentApiKeys).values({ hash: keyHash, agentId, workspaceId });
  });

  // Auto-add to workspace Public group (best-effort)
  const { permissionGroups } = await import('../db/schema');
  const [pubGroup] = await db.select().from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, workspaceId), eq(permissionGroups.type, 'public')));
  if (pubGroup) {
    const currentIds = (pubGroup.memberIds as string[]) ?? [];
    if (!currentIds.includes(agentId)) {
      await db.update(permissionGroups)
        .set({ memberIds: [...currentIds, agentId] })
        .where(and(eq(permissionGroups.id, pubGroup.id), eq(permissionGroups.workspaceId, workspaceId)));
    }
  }

  res.status(201).json({ agentId, apiKey: rawKey });
}));

agentsRouter.get('/mine', authMiddleware, requireIdentity, wrap(async (req, res) => {
  const { uid, agentId: authAgentId } = req.auth!;

  if (uid) {
    const rows = await db.select().from(agents).where(eq(agents.authUserId, uid));
    res.json(rows.map(row => {
      const { apiKeyHash: _, ...data } = row;
      return { ...data, balance: fromUnits(data.balance as number) };
    }));
  } else {
    const [agent] = await db.select().from(agents).where(eq(agents.id, authAgentId!));
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    const { apiKeyHash: _, ...data } = agent;
    res.json([{ ...data, balance: fromUnits(data.balance as number) }]);
  }
}));

/** Public: treasury receive address for USDC deposits (no balances; does not require auth). */
agentsRouter.get('/deposit-address', (_req, res) => {
  if (!requireUsdcEnabled(res)) return;
  try {
    const address = getTreasuryAddress();
    res.json({
      address,
      chain: 'base',
      asset: 'USDC',
      usdcContract: USDC_ON_BASE_MAINNET,
    });
  } catch {
    res.status(503).json({ error: 'Treasury is not configured on this server' });
  }
});

agentsRouter.use(authMiddleware);

agentsRouter.get('/treasury', requireRole('admin'), wrap(async (req, res) => {
  if (!requireUsdcEnabled(res)) return;
  res.json(await getTreasuryBalances());
}));

agentsRouter.get('/:id', requireSelfOrAdmin, wrap(async (req, res) => {
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
  const { apiKeyHash: _, ...data } = agent;
  res.json({ ...data, balance: fromUnits(data.balance as number) });
}));

agentsRouter.get('/:id/balance', requireSelfOrAdmin, wrap(async (req, res) => {
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
  res.json({ balance: fromUnits(agent.balance as number) });
}));

agentsRouter.get('/:id/dashboard', requireSelfOrAdmin, wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 10;
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }

  const [agent, mkts] = await Promise.all([
    db.select().from(agents).where(eq(agents.id, id)).then(r => r[0]),
    getMarkets({ active: true, minLiquidity: 0.01, limit }, undefined, workspaceId),
  ]);

  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
  res.json({ balance: fromUnits(agent.balance as number), markets: mkts });
}));

agentsRouter.get('/', requireRole('admin'), wrap(async (_req, res) => {
  const rows = await listParticipantsForWorkspace(_req.auth!.workspaceId);
  res.json(rows.map(a => {
    const { apiKeyHash: _, ...data } = a;
    return { ...data, balance: fromUnits(data.balance as number) };
  }));
}));

agentsRouter.put('/:id/approve', requireRole('admin'), wrap(async (req, res) => {
  const id = req.params.id as string;
  const members = await listParticipantsForWorkspace(req.auth!.workspaceId);
  if (!members.some(m => m.id === id)) { res.status(403).json({ error: 'Agent is not in your workspace' }); return; }
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
  await db.update(agents).set({ role: 'agent', approvedAt: new Date() }).where(eq(agents.id, id));
  res.json({ ok: true });
}));

agentsRouter.put('/:id/role', requireRole('admin'), wrap(async (req, res) => {
  const { role } = req.body;
  if (!role || !['admin', 'agent', 'pending'].includes(role)) {
    res.status(400).json({ error: 'Invalid role' }); return;
  }
  const id = req.params.id as string;
  const members = await listParticipantsForWorkspace(req.auth!.workspaceId);
  if (!members.some(m => m.id === id)) { res.status(403).json({ error: 'Agent is not in your workspace' }); return; }
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
  await db.update(agents).set({ role }).where(eq(agents.id, id));
  res.json({ ok: true });
}));

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
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
  if (!sufficientBalance(agent.balance as number, amount)) {
    res.status(400).json({ error: 'Insufficient balance', balance: fromUnits(agent.balance as number) }); return;
  }

  const field = type === 'betting' ? 'spentBetting' : 'spentTokens';
  await db.update(agents).set({
    balance: sql`${agents.balance} - ${toUnits(amount)}`,
    [field]: sql`${agents[field as keyof typeof agents]} + ${amount}`,
  }).where(eq(agents.id, id));
  res.json({ ok: true, spent: amount, type, reason: reason || '' });
}));

agentsRouter.post('/:id/credit', requireRole('admin'), wrap(async (req, res) => {
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(400).json({ error: 'Agent not found' }); return; }
  const members = await listParticipantsForWorkspace(req.auth!.workspaceId);
  if (!members.some(m => m.id === id)) { res.status(403).json({ error: 'Agent is not in your workspace' }); return; }
  const { amount, reason = 'admin credit' } = req.body;
  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' }); return;
  }
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
  await db.update(agents).set({ balance: sql`${agents.balance} + ${toUnits(amount)}` }).where(eq(agents.id, id));
  const [updated] = await db.select({ balance: agents.balance }).from(agents).where(eq(agents.id, id));
  const newBalance = fromUnits(updated.balance as number);
  console.log(`[admin credit] ${id} +${amount} credits (${reason}). New balance: ${newBalance}`);
  res.json({ ok: true, credited: amount, balance: newBalance });
}));

agentsRouter.post('/:id/deposit', requireSelfOrAdmin, wrap(async (req, res) => {
  if (!requireUsdcEnabled(res)) return;
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }
  const { txHash } = req.body;
  const txHashError = validateTxHash(txHash);
  if (txHashError) { res.status(400).json({ error: txHashError }); return; }

  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

  const [existing] = await db.select().from(deposits).where(eq(deposits.txHash, txHash));
  if (existing) { res.status(409).json({ error: 'This transaction has already been used to purchase credits' }); return; }

  const [economy] = await db.select().from(systemConfig).where(eq(systemConfig.key, 'economy'));
  const economyData = (economy?.value as { creditValueUsd?: number; buyFeePercent?: number }) ?? {};
  const creditValueUsd = economyData.creditValueUsd ?? 1;
  const buyFeePercent = economyData.buyFeePercent ?? 0;
  const buyRate = depositBuyRateUsd(creditValueUsd, buyFeePercent);

  const { usdcAmount, from } = await verifyUsdcDeposit(txHash);
  const credits = creditsIssuedForUsdcDeposit(usdcAmount, creditValueUsd, buyFeePercent);

  if (credits <= 0) {
    res.status(400).json({ error: `Deposit too small. Minimum: ${buyRate.toFixed(6)} USDC for 1 credit` }); return;
  }

  await db.transaction(async tx => {
    await tx.insert(deposits).values({ txHash, agentId: id, from, usdcAmount, credits, buyRate, createdAt: new Date() });
    await tx.update(agents).set({ balance: sql`${agents.balance} + ${toUnits(credits)}` }).where(eq(agents.id, id));
  });

  res.status(201).json({ ok: true, usdcAmount, credits, buyRate, from });
}));

agentsRouter.put('/:id/wallet', requireSelfOrAdmin, wrap(async (req, res) => {
  if (!requireUsdcEnabled(res)) return;
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }
  const { walletAddress } = req.body;
  if (!walletAddress || typeof walletAddress !== 'string') {
    res.status(400).json({ error: 'walletAddress is required' }); return;
  }
  const checksummed = validateWalletAddress(walletAddress);
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
  await db.update(agents).set({ walletAddress: checksummed }).where(eq(agents.id, id));
  res.json({ ok: true, walletAddress: checksummed });
}));

agentsRouter.post('/:id/withdraw', requireSelfOrAdmin, wrap(async (req, res) => {
  if (!requireUsdcEnabled(res)) return;
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }
  const { amount } = req.body;
  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' }); return;
  }

  const [economy] = await db.select().from(systemConfig).where(eq(systemConfig.key, 'economy'));
  const economyData = (economy?.value as { creditValueUsd?: number }) ?? {};
  const creditValueUsd = economyData.creditValueUsd ?? null;
  if (!creditValueUsd) throw new AppError('creditValueUsd is not configured', 500);

  let walletAddress!: string;
  await db.transaction(async tx => {
    const [agent] = await tx.select().from(agents).where(eq(agents.id, id)).for('update');
    if (!agent) throw new AppError('Agent not found', 404);
    if (!agent.walletAddress) throw new AppError('Agent has no registered wallet address', 400);
    if (!sufficientBalance(agent.balance as number, amount)) {
      throw new AppError(`Insufficient balance (have ${fromUnits(agent.balance as number)}, need ${amount})`, 400);
    }
    walletAddress = agent.walletAddress;
    await tx.update(agents).set({ balance: sql`${agents.balance} - ${toUnits(amount)}` }).where(eq(agents.id, id));
  });

  const usdcAmount = Math.round(amount * creditValueUsd * 1e6) / 1e6;

  let txHash: string;
  try {
    txHash = await sendUsdc(walletAddress, usdcAmount);
  } catch (err) {
    await db.update(agents).set({ balance: sql`${agents.balance} + ${toUnits(amount)}` }).where(eq(agents.id, id));
    console.error(`[withdraw] USDC send failed for agent ${id}, re-credited ${amount} credits:`, err);
    throw new AppError('On-chain transfer failed; credits have been restored', 502);
  }

  const withdrawalId = randomUUID();
  await Promise.all([
    db.insert(withdrawals).values({
      id: withdrawalId, agentId: id, credits: amount, usdcAmount,
      toAddress: walletAddress, txHash, createdAt: new Date(),
    }),
    db.update(agents).set({ withdrawnUsdc: sql`${agents.withdrawnUsdc} + ${usdcAmount}` }).where(eq(agents.id, id)),
  ]);

  res.json({ ok: true, credits: amount, usdcAmount, txHash, toAddress: walletAddress });
}));

agentsRouter.delete('/:id', requireRole('admin'), wrap(async (req, res) => {
  const id = req.params.id as string;
  const members = await listParticipantsForWorkspace(req.auth!.workspaceId);
  if (!members.some(m => m.id === id)) { res.status(403).json({ error: 'Agent is not in your workspace' }); return; }
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

  await db.transaction(async tx => {
    await tx.delete(agentApiKeys).where(eq(agentApiKeys.agentId, id));
    await tx.delete(agents).where(eq(agents.id, id));
  });

  res.status(204).send();
}));
