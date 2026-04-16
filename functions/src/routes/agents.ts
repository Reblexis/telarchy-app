import { Router, type Request } from 'express';
import { db } from '../db/client';
import { agents, agentApiKeys, deposits, withdrawals, systemConfig, workspaces, positions, trades, markets, permissionGroups } from '../db/schema';
import { eq, and, sql, inArray, desc } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { randomUUID } from 'crypto';
import { wrap } from '../lib/wrap';
import { hashKey, authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { requireCapability, requireSelfOrAdmin, requireIdentity } from '../middleware/roles';
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
import { directionSellProceeds, resolutionPayouts, pHigher, consensus } from '../lib/amm';
import { getAllMetrics } from '../services/metrics';

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
      id: agentId, apiKeyHash: keyHash, balance: 0,
      authUserId: req.auth?.uid ?? null, createdAt: new Date(), approvedAt: new Date(),
    });
    await tx.insert(agentApiKeys).values({ hash: keyHash, agentId, workspaceId });
  });

  // Auto-add to workspace Public and Trader groups (participant symmetry:
  // registered agents get read+trade by default, matching what a human
  // user would have after creating their own workspace).
  const { permissionGroups } = await import('../db/schema');
  const sysGroups = await db.select().from(permissionGroups)
    .where(eq(permissionGroups.workspaceId, workspaceId));
  for (const targetType of ['public', 'trader'] as const) {
    const group = sysGroups.find(g => g.type === targetType);
    if (!group) continue;
    const currentIds = (group.memberIds as string[]) ?? [];
    if (!currentIds.includes(agentId)) {
      await db.update(permissionGroups)
        .set({ memberIds: [...currentIds, agentId] })
        .where(and(eq(permissionGroups.id, group.id), eq(permissionGroups.workspaceId, workspaceId)));
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

agentsRouter.get('/treasury', requireCapability('manage'), wrap(async (req, res) => {
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

agentsRouter.get('/:id/market-pnl', requireSelfOrAdmin, wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }

  const [tradeRows, posRows] = await Promise.all([
    db.select({ marketId: trades.marketId, cost: trades.cost, shares: trades.shares, direction: trades.direction })
      .from(trades).where(and(eq(trades.workspaceId, workspaceId), eq(trades.agentId, id))),
    db.select().from(positions).where(and(eq(positions.workspaceId, workspaceId), eq(positions.agentId, id))),
  ]);

  const marketIds = [...new Set([...tradeRows.map(t => t.marketId), ...posRows.map(p => p.marketId)])];
  if (marketIds.length === 0) { res.json([]); return; }

  const [marketRows, allMetrics] = await Promise.all([
    db.select().from(markets).where(and(eq(markets.workspaceId, workspaceId), inArray(markets.id, marketIds))),
    getAllMetrics(workspaceId),
  ]);
  const metricMap = new Map(allMetrics.map(m => [m.id, m]));

  // Exclude voided markets: their trade costs were refunded via position
  // totalCost (not recorded as trades), so netCash from trades alone is wrong.
  const nonVoidedMarkets = marketRows.filter(m => !m.voided);

  const cashByMarket = new Map<string, number>();
  for (const t of tradeRows) {
    cashByMarket.set(t.marketId, (cashByMarket.get(t.marketId) ?? 0) - t.cost);
  }

  const result = nonVoidedMarkets.map(m => {
    const netCash = cashByMarket.get(m.id) ?? 0;
    const mktShares = (m.shares as [number, number]) || [0, 0];
    const b = m.liquidity;
    const agentPos = posRows.filter(p => p.marketId === m.id);
    const higherShares = agentPos.find(p => p.direction === 'higher')?.shares ?? 0;
    const lowerShares = agentPos.find(p => p.direction === 'lower')?.shares ?? 0;

    // Mark-to-market via LMSR sell proceeds (what you'd get if you unwound now).
    const sellHi = higherShares > 0 ? directionSellProceeds(mktShares, 1, higherShares, b) : 0;
    const sellLo = lowerShares > 0 ? directionSellProceeds(mktShares, 0, lowerShares, b) : 0;
    const markValueConsensus = sellHi + sellLo;
    const pnlConsensus = netCash + markValueConsensus;

    let pnlMetric: number | null = null;
    let metricValue: number | null = null;
    let metricPayoutValue: number | null = null;
    if (m.resolved && m.actualValue !== null) {
      const [lowerPay, higherPay] = resolutionPayouts(Math.min(m.actualValue, m.rangeMax), m.rangeMin, m.rangeMax);
      metricPayoutValue = higherShares * higherPay + lowerShares * lowerPay;
      pnlMetric = netCash + metricPayoutValue;
      metricValue = m.actualValue;
    } else {
      const metric = metricMap.get(m.metricId);
      if (metric?.total !== null && metric?.total !== undefined) {
        metricValue = metric.total;
        const clamped = Math.min(Math.max(metric.total, m.rangeMin), m.rangeMax);
        const [lowerPay, higherPay] = resolutionPayouts(clamped, m.rangeMin, m.rangeMax);
        metricPayoutValue = higherShares * higherPay + lowerShares * lowerPay;
        pnlMetric = netCash + metricPayoutValue;
      }
    }

    return {
      marketId: m.id,
      metricId: m.metricId,
      metricName: m.metricName,
      targetDate: m.targetDate,
      status: m.voided ? 'voided' : m.resolved ? 'resolved' : (m.active === false ? 'closed' : 'open'),
      rangeMin: m.rangeMin,
      rangeMax: m.rangeMax,
      consensus: consensus(mktShares, b, m.rangeMin, m.rangeMax) ?? null,
      probabilityHigher: pHigher(mktShares, b),
      metricValue,
      higherShares,
      lowerShares,
      netCash,
      markValueConsensus,
      metricPayoutValue,
      pnlConsensus,
      pnlMetric,
    };
  });

  // Sort: open first, then by absolute PnL magnitude desc.
  result.sort((a, b) => {
    const rank = (s: string) => s === 'open' ? 0 : s === 'closed' ? 1 : 2;
    const rd = rank(a.status) - rank(b.status);
    if (rd !== 0) return rd;
    return Math.abs(b.pnlConsensus) - Math.abs(a.pnlConsensus);
  });

  res.json(result);
}));

agentsRouter.get('/:id/trades', requireSelfOrAdmin, wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(403).json({ error: 'A participant identity is required' }); return; }
  const limit = typeof req.query.limit === 'string' ? Math.min(parseInt(req.query.limit, 10) || 100, 500) : 100;

  const rows = await db.select({
    id: trades.id,
    marketId: trades.marketId,
    direction: trades.direction,
    shares: trades.shares,
    cost: trades.cost,
    createdAt: trades.createdAt,
    metricName: markets.metricName,
    targetDate: markets.targetDate,
    resolved: markets.resolved,
    voided: markets.voided,
  })
    .from(trades)
    .leftJoin(markets, and(eq(markets.id, trades.marketId), eq(markets.workspaceId, workspaceId)))
    .where(and(eq(trades.workspaceId, workspaceId), eq(trades.agentId, id)))
    .orderBy(desc(trades.createdAt))
    .limit(limit);

  res.json(rows.map(r => ({
    id: r.id,
    marketId: r.marketId,
    metricName: r.metricName,
    targetDate: r.targetDate,
    direction: r.direction,
    // trades.shares is negative for sells; surface sign + absolute amount.
    kind: r.shares < 0 ? 'sell' : 'buy',
    shares: Math.abs(r.shares),
    cost: r.cost,
    marketStatus: r.voided ? 'voided' : r.resolved ? 'resolved' : 'open',
    createdAt: r.createdAt,
  })));
}));

agentsRouter.get('/', requireCapability('manage'), wrap(async (_req, res) => {
  const workspaceId = _req.auth!.workspaceId;
  const rows = await listParticipantsForWorkspace(workspaceId);

  // Realized PnL per agent = net cash flow from trades on resolved (non-voided)
  // markets + resolution payouts received. Open/voided markets don't count.
  const resolvedMarkets = await db.select({
    id: markets.id,
    rangeMin: markets.rangeMin,
    rangeMax: markets.rangeMax,
    actualValue: markets.actualValue,
  }).from(markets).where(and(
    eq(markets.workspaceId, workspaceId),
    eq(markets.resolved, true),
    eq(markets.voided, false),
  ));

  const realizedPnl = new Map<string, number>();
  if (resolvedMarkets.length > 0) {
    const marketIds = resolvedMarkets.map(m => m.id);
    const payFactorsById = new Map<string, [number, number]>();
    for (const m of resolvedMarkets) {
      if (m.actualValue === null) continue;
      const actual = Math.min(m.actualValue, m.rangeMax);
      payFactorsById.set(m.id, resolutionPayouts(actual, m.rangeMin, m.rangeMax));
    }

    const [tradeRows, posRows] = await Promise.all([
      db.select({ agentId: trades.agentId, cost: trades.cost }).from(trades)
        .where(and(eq(trades.workspaceId, workspaceId), inArray(trades.marketId, marketIds))),
      db.select({ agentId: positions.agentId, marketId: positions.marketId, direction: positions.direction, shares: positions.shares }).from(positions)
        .where(and(eq(positions.workspaceId, workspaceId), inArray(positions.marketId, marketIds))),
    ]);

    for (const t of tradeRows) {
      realizedPnl.set(t.agentId, (realizedPnl.get(t.agentId) ?? 0) - t.cost);
    }
    for (const p of posRows) {
      if (p.shares <= 0) continue;
      const pay = payFactorsById.get(p.marketId);
      if (!pay) continue;
      const factor = p.direction === 'higher' ? pay[1] : pay[0];
      const payout = p.shares * factor;
      realizedPnl.set(p.agentId, (realizedPnl.get(p.agentId) ?? 0) + payout);
    }
  }

  // Aggregate per-agent PnL @ consensus and PnL @ metric across every
  // non-voided market the agent has traded or holds positions on.
  // Voided markets are excluded: their trade costs were refunded via position
  // totalCost (not recorded as trades), so summing trades alone is incorrect.
  const pnlConsensusByAgent = new Map<string, number>();
  const pnlMetricByAgent = new Map<string, number>();
  const [allMarkets, allMetricsList, allTrades, allPositions] = await Promise.all([
    db.select().from(markets).where(and(eq(markets.workspaceId, workspaceId), eq(markets.voided, false))),
    getAllMetrics(workspaceId),
    db.select({ agentId: trades.agentId, marketId: trades.marketId, cost: trades.cost }).from(trades)
      .where(eq(trades.workspaceId, workspaceId)),
    db.select({ agentId: positions.agentId, marketId: positions.marketId, direction: positions.direction, shares: positions.shares }).from(positions)
      .where(eq(positions.workspaceId, workspaceId)),
  ]);
  const marketById = new Map(allMarkets.map(m => [m.id, m]));
  const metricById = new Map(allMetricsList.map(m => [m.id, m]));

  // Net cash per (agent, market), excluding voided markets.
  const nonVoidedMarketIds = new Set(allMarkets.map(m => m.id));
  const cashKey = (a: string, mId: string) => `${a}\u0000${mId}`;
  const netCashBy = new Map<string, number>();
  for (const t of allTrades) {
    if (!nonVoidedMarketIds.has(t.marketId)) continue;
    const k = cashKey(t.agentId, t.marketId);
    netCashBy.set(k, (netCashBy.get(k) ?? 0) - t.cost);
  }

  // Mark-to-market + metric-payout per (agent, market) from position rows.
  const touched = new Set<string>();
  const markByAgentMarket = new Map<string, number>();
  const metricPayByAgentMarket = new Map<string, number>();
  for (const p of allPositions) {
    if (p.shares <= 0) continue;
    const m = marketById.get(p.marketId);
    if (!m) continue;
    const mktShares = (m.shares as [number, number]) || [0, 0];
    const dirIdx: 0 | 1 = p.direction === 'higher' ? 1 : 0;
    const sell = directionSellProceeds(mktShares, dirIdx, p.shares, m.liquidity);
    const k = cashKey(p.agentId, p.marketId);
    markByAgentMarket.set(k, (markByAgentMarket.get(k) ?? 0) + sell);
    touched.add(k);

    let settleValue: number | null = null;
    if (m.resolved && m.actualValue !== null) {
      const [lo, hi] = resolutionPayouts(Math.min(m.actualValue, m.rangeMax), m.rangeMin, m.rangeMax);
      settleValue = p.direction === 'higher' ? p.shares * hi : p.shares * lo;
    } else {
      const metric = metricById.get(m.metricId);
      if (metric?.total !== null && metric?.total !== undefined) {
        const clamped = Math.min(Math.max(metric.total, m.rangeMin), m.rangeMax);
        const [lo, hi] = resolutionPayouts(clamped, m.rangeMin, m.rangeMax);
        settleValue = p.direction === 'higher' ? p.shares * hi : p.shares * lo;
      }
    }
    if (settleValue !== null) {
      metricPayByAgentMarket.set(k, (metricPayByAgentMarket.get(k) ?? 0) + settleValue);
    }
  }
  for (const [k] of netCashBy) touched.add(k);

  for (const k of touched) {
    const [agentId] = k.split('\u0000');
    const cash = netCashBy.get(k) ?? 0;
    const mark = markByAgentMarket.get(k) ?? 0;
    const metricPay = metricPayByAgentMarket.get(k) ?? 0;
    pnlConsensusByAgent.set(agentId, (pnlConsensusByAgent.get(agentId) ?? 0) + cash + mark);
    pnlMetricByAgent.set(agentId, (pnlMetricByAgent.get(agentId) ?? 0) + cash + metricPay);
  }

  res.json(rows.map(a => {
    const { apiKeyHash: _, ...data } = a;
    return {
      ...data,
      balance: fromUnits(data.balance as number),
      realizedPnl: realizedPnl.get(a.id) ?? 0,
      pnlConsensus: pnlConsensusByAgent.get(a.id) ?? 0,
      pnlMetric: pnlMetricByAgent.get(a.id) ?? 0,
    };
  }));
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
  if (type === 'betting' && !req.auth!.capabilities.has('manage')) {
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

agentsRouter.post('/:id/credit', requireCapability('manage'), wrap(async (req, res) => {
  const id = resolveRouteAgentId(req);
  if (!id) { res.status(400).json({ error: 'Agent not found' }); return; }
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
  const members = await listParticipantsForWorkspace(req.auth!.workspaceId);
  if (!members.some(m => m.id === id)) { res.status(403).json({ error: 'Agent is not in your workspace' }); return; }
  const { amount, reason = 'admin credit' } = req.body;
  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' }); return;
  }
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

agentsRouter.delete('/:id', requireCapability('manage'), wrap(async (req, res) => {
  const id = req.params.id as string;
  const workspaceId = req.auth!.workspaceId;
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

  // Unwind positions: sell all shares at current market rates to restore LMSR state
  const agentPositions = await db.select().from(positions)
    .where(and(eq(positions.agentId, id), eq(positions.workspaceId, workspaceId)));

  let positionsUnwound = 0;
  await db.transaction(async tx => {
    for (const pos of agentPositions) {
      if (pos.shares <= 0) continue;
      const [market] = await tx.select().from(markets)
        .where(and(eq(markets.id, pos.marketId), eq(markets.workspaceId, workspaceId)));
      if (!market) continue;

      const mktShares = market.shares as [number, number];
      const dirIdx: 0 | 1 = pos.direction === 'higher' ? 1 : 0;
      const proceeds = directionSellProceeds(mktShares, dirIdx, pos.shares, market.liquidity);

      // Update market shares (remove this agent's shares)
      const newShares: [number, number] = [mktShares[0], mktShares[1]];
      newShares[dirIdx] -= pos.shares;
      await tx.update(markets).set({
        shares: newShares,
        pool: sql`${markets.pool} - ${proceeds}`,
      }).where(and(eq(markets.id, pos.marketId), eq(markets.workspaceId, workspaceId)));

      positionsUnwound++;
    }

    // Remove from permission groups
    const groups = await tx.select().from(permissionGroups)
      .where(eq(permissionGroups.workspaceId, workspaceId));
    for (const group of groups) {
      const memberIds = (group.memberIds as string[]) ?? [];
      if (memberIds.includes(id)) {
        await tx.update(permissionGroups)
          .set({ memberIds: memberIds.filter(m => m !== id) })
          .where(and(eq(permissionGroups.id, group.id), eq(permissionGroups.workspaceId, workspaceId)));
      }
    }

    // Delete all agent data
    await tx.delete(trades).where(eq(trades.agentId, id));
    await tx.delete(positions).where(eq(positions.agentId, id));
    await tx.delete(deposits).where(eq(deposits.agentId, id));
    await tx.delete(withdrawals).where(eq(withdrawals.agentId, id));
    await tx.delete(agentApiKeys).where(eq(agentApiKeys.agentId, id));
    await tx.delete(agents).where(eq(agents.id, id));
  });

  console.log(`[agent delete] ${id}: unwound ${positionsUnwound} positions, removed from groups, deleted`);
  res.json({ ok: true, positionsUnwound });
}));
