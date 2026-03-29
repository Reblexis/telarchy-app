import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../lib/db';
import { wsCol } from '../lib/workspace';
import { wrap } from '../lib/wrap';
import { AppError } from '../lib/errors';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { getAllMetrics, getMetricLogs, getUpdates } from '../services/metrics';
import { resolvePredictions, resolveMarket, getMarkets, voidMarket } from '../services/predictions';
import { refreshRelativeDateMarkets } from '../services/markets';
import { createConditionalMarkets } from '../services/tasks';
import { isValidDateFormat, endOfPeriod } from '../lib/date-utils';
import { extractMetricReferences } from '../lib/metrics-engine';
import { consensus, pHigher, directionTradeCost, sharesForBudget, betTowardsValue, directionSellProceeds, lmsrCost, initialPool, AMM_DEFAULTS } from '../lib/amm';
import { emitEvent } from '../services/events';
import { sufficientBalance, toUnits, fromUnits } from '../lib/validation';

export const predictionsRouter = Router();

predictionsRouter.use(authMiddleware);

// --- Agent-accessible ---

predictionsRouter.post('/trade', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const agentId = req.auth!.agentId;
  if (!agentId) { res.status(403).json({ error: 'Only agents can trade' }); return; }

  const { marketId } = req.body;
  if (!marketId || typeof marketId !== 'string') { res.status(400).json({ error: 'marketId is required' }); return; }

  // Determine trade mode from request body — no Firestore reads needed at this stage.
  // Direction/amount computation requires fresh market state so happens inside the transaction.
  type TradeMode =
    | { type: 'targetValue'; targetValue: number; maxBudget: number }
    | { type: 'sell'; direction: 0 | 1; dirLabel: 'higher' | 'lower'; sellShares: number }
    | { type: 'buy'; direction: 0 | 1; dirLabel: 'higher' | 'lower'; amount: number };

  let mode: TradeMode;
  const targetValue = req.body.targetValue ?? req.body.value;
  const maxBudget = req.body.maxBudget ?? req.body.amount;
  if (typeof targetValue === 'number' && typeof maxBudget === 'number') {
    if (maxBudget <= 0) { res.status(400).json({ error: 'maxBudget/amount must be positive' }); return; }
    mode = { type: 'targetValue', targetValue, maxBudget };
  } else if (typeof req.body.direction === 'string' && typeof req.body.sellShares === 'number') {
    if (req.body.direction !== 'higher' && req.body.direction !== 'lower') {
      res.status(400).json({ error: 'direction must be "higher" or "lower"' }); return;
    }
    if (req.body.sellShares <= 0) { res.status(400).json({ error: 'sellShares must be positive' }); return; }
    const dir = req.body.direction as 'higher' | 'lower';
    mode = { type: 'sell', direction: dir === 'higher' ? 1 : 0, dirLabel: dir, sellShares: req.body.sellShares };
  } else if (typeof req.body.direction === 'string' && typeof req.body.amount === 'number') {
    if (req.body.direction !== 'higher' && req.body.direction !== 'lower') {
      res.status(400).json({ error: 'direction must be "higher" or "lower"' }); return;
    }
    if (req.body.amount <= 0) { res.status(400).json({ error: 'amount must be positive' }); return; }
    const dir = req.body.direction as 'higher' | 'lower';
    mode = { type: 'buy', direction: dir === 'higher' ? 1 : 0, dirLabel: dir, amount: req.body.amount };
  } else {
    res.status(400).json({ error: 'Provide {targetValue, maxBudget}, {direction, amount}, or {direction, sellShares}' }); return;
  }

  const marketRef = wsCol(workspaceId, 'markets').doc(marketId);
  // agents is a global collection — not workspace-scoped
  const agentRef = db().collection('agents').doc(agentId);
  // Generate the trade doc ID outside the transaction so it's stable across retries.
  const tradeRef = wsCol(workspaceId, 'trades').doc();

  // Pre-check: verify this agent's permission groups allow trading this metric.
  // If any group has trade:true for this metric, only agents in those groups may trade.
  // Exception: the 'public' group grants access to all agents implicitly.
  {
    const marketSnap = await marketRef.get();
    if (marketSnap.exists) {
      const metricId = marketSnap.data()!.metricId as string | undefined;
      if (metricId) {
        const groupsSnap = await wsCol(workspaceId, 'permissionGroups').get();
        const restrictingGroups = groupsSnap.docs.filter(d => {
          const perms = d.data().permissions as Record<string, { trade: boolean }> | undefined;
          return perms?.[metricId]?.trade === true;
        });
        if (restrictingGroups.length > 0) {
          // Public group grants access to everyone
          const publicGroupRestricts = restrictingGroups.some(g => g.data().type === 'public');
          if (!publicGroupRestricts) {
            const agentInGroup = restrictingGroups.some(g => {
              const ids = g.data().agentIds as string[] | undefined;
              return ids?.includes(agentId);
            });
            if (!agentInGroup) {
              res.status(403).json({ error: 'Agent not authorized to trade this metric' });
              return;
            }
          }
        }
      }
    }
  }

  // Capture values set inside the transaction for use in the response and event emission.
  let tradeResponse: Record<string, unknown>;
  let eventPayload: Record<string, unknown>;

  // All reads, validation, computation, and writes happen atomically inside the transaction.
  // Firestore retries automatically on contention — the callback must be side-effect-free
  // (no external calls). emitEvent runs after the transaction commits.
  await db().runTransaction(async (tx) => {
    const [marketDoc, agentDoc] = await Promise.all([tx.get(marketRef), tx.get(agentRef)]);

    if (!marketDoc.exists) throw new AppError('Market not found', 404);
    const market = marketDoc.data()!;
    if (market.resolved) throw new AppError('Market is resolved', 400);
    if (market.active === false) throw new AppError('Market is inactive', 400);

    const shares: [number, number] = market.shares;
    const b = market.liquidity;
    if (b <= 0) throw new AppError('Market has no liquidity — admin must inject liquidity before trading', 400);

    if (!agentDoc.exists) throw new AppError('Agent not found', 404);
    const balance = fromUnits(agentDoc.data()!.balance as number);

    // Compute direction, amount, and cost from fresh market state.
    let direction: 0 | 1;
    let amount: number;
    let cost = 0;
    let isSell = false;
    let dirLabel: 'higher' | 'lower';

    if (mode.type === 'targetValue') {
      if (mode.targetValue < market.rangeMin || mode.targetValue > market.rangeMax) {
        throw new AppError(`targetValue/value must be between ${market.rangeMin} and ${market.rangeMax}`, 400);
      }
      const r = betTowardsValue(shares, b, market.rangeMin, market.rangeMax, mode.targetValue, mode.maxBudget);
      direction = r.direction; amount = r.amount; cost = r.cost;
      dirLabel = direction === 1 ? 'higher' : 'lower';
    } else if (mode.type === 'sell') {
      direction = mode.direction; dirLabel = mode.dirLabel;
      amount = mode.sellShares; isSell = true;
    } else {
      direction = mode.direction; dirLabel = mode.dirLabel;
      const r = sharesForBudget(shares, direction, mode.amount, b);
      amount = r.amount; cost = r.cost;
    }

    if (amount <= 0) throw new AppError('Trade too small', 400);

    // Read position after direction is resolved (posId includes direction).
    const posId = `${agentId}_${marketId}_${dirLabel}`;
    const posRef = wsCol(workspaceId, 'positions').doc(posId);
    const posDoc = await tx.get(posRef);

    let proceeds = 0;
    if (isSell) {
      const posShares = posDoc.exists ? (posDoc.data()!.shares as number) : 0;
      if (posShares < amount) throw new AppError('Insufficient shares to sell', 400, { available: posShares });
      proceeds = directionSellProceeds(shares, direction, amount, b);
      if (proceeds <= 0) throw new AppError('Trade too small', 400);
    } else {
      if (cost > 0 && !sufficientBalance(balance, cost)) throw new AppError('Insufficient balance', 400, { balance, cost });
    }

    const newShares: [number, number] = [shares[0], shares[1]];
    newShares[direction] += isSell ? -amount : amount;

    const newConsensus = consensus(newShares, b, market.rangeMin, market.rangeMax) ?? null;
    const newProbability = Math.round(pHigher(newShares, b) * 10000) / 10000;

    if (isSell) {
      tx.update(marketRef, { shares: newShares, pool: FieldValue.increment(-proceeds) });
      tx.update(agentRef, { balance: toUnits(balance + proceeds), earnedBetting: FieldValue.increment(proceeds) });
      tx.update(posRef, { shares: FieldValue.increment(-amount) });
    } else {
      tx.update(marketRef, { shares: newShares, pool: FieldValue.increment(cost) });
      tx.update(agentRef, { balance: toUnits(balance - cost), spentBetting: FieldValue.increment(cost) });
      if (posDoc.exists) {
        tx.update(posRef, { shares: FieldValue.increment(amount), totalCost: FieldValue.increment(cost) });
      } else {
        tx.set(posRef, { id: posId, agentId, marketId, direction: dirLabel, shares: amount, totalCost: cost });
      }
      if (workspaceId !== 'default' && cost > 0) {
        tx.update(db().collection('workspaces').doc(workspaceId), { tradedVolume: FieldValue.increment(cost) });
      }
    }

    tx.set(tradeRef, {
      id: tradeRef.id, agentId, marketId, direction: dirLabel,
      shares: isSell ? -amount : amount,
      cost: isSell ? -proceeds : cost,
      consensus: newConsensus, probability: newProbability,
      createdAt: FieldValue.serverTimestamp(),
    });

    tradeResponse = isSell
      ? { tradeId: tradeRef.id, marketId, direction: dirLabel, shares: amount, proceeds, probability: newProbability, consensus: newConsensus }
      : { tradeId: tradeRef.id, marketId, direction: dirLabel, shares: amount, cost, probability: newProbability, consensus: newConsensus };
    eventPayload = { marketId, metricName: market.metricName, agentId, direction: dirLabel, cost: isSell ? -proceeds : cost, newConsensus };
  });

  res.status(201).json(tradeResponse!);
  emitEvent('trade:executed', eventPayload!, workspaceId).catch(e => console.error('emitEvent failed:', e));
}));

predictionsRouter.get('/positions', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const agentId = req.auth!.role === 'admin' && typeof req.query.agentId === 'string'
    ? req.query.agentId
    : req.auth!.agentId;
  if (!agentId) { res.status(403).json({ error: 'Only agents can list positions' }); return; }

  let query: FirebaseFirestore.Query = wsCol(workspaceId, 'positions').where('agentId', '==', agentId);
  if (req.query.marketId) query = query.where('marketId', '==', req.query.marketId as string);

  const snapshot = await query.get();
  res.json(snapshot.docs.map(doc => doc.data()).filter((p: Record<string, unknown>) => (p.shares as number) > 0));
}));

predictionsRouter.get('/markets', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const taskId = typeof req.query.taskId === 'string' ? req.query.taskId : undefined;
  if (taskId) {
    const taskRef = wsCol(workspaceId, 'tasks').doc(taskId);
    const taskDoc = await taskRef.get();
    if (taskDoc.exists) {
      const task = taskDoc.data()!;
      if (!task.conditionalMarketIds?.length) {
        const marketIds = await createConditionalMarkets(taskId, workspaceId);
        await taskRef.update({ conditionalMarketIds: marketIds });
      }
    }
  } else {
    // Ensure all TP-implied markets exist before returning. refreshRelativeDateMarkets
    // uses a Firestore lock with a 5-minute cooldown so this is a cheap no-op for most
    // requests; only the first call after the cooldown does real work.
    await refreshRelativeDateMarkets(workspaceId);
  }
  const active = req.query.active === 'true' ? true : req.query.active === 'false' ? false : undefined;
  const minLiquidity = typeof req.query.minLiquidity === 'string' ? parseFloat(req.query.minLiquidity) : undefined;
  const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
  res.json(await getMarkets({ taskId, active, minLiquidity, limit }, undefined, workspaceId));
}));

predictionsRouter.get('/markets/:id/trades', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const last = typeof req.query.last === 'string' ? parseInt(req.query.last, 10) : undefined;
  let query: FirebaseFirestore.Query = wsCol(workspaceId, 'trades')
    .where('marketId', '==', req.params.id as string)
    .orderBy('createdAt', last !== undefined ? 'desc' : 'asc');
  if (last !== undefined) query = query.limit(last);
  const snap = await query.get();
  const docs = last !== undefined ? snap.docs.reverse() : snap.docs;
  res.json(docs.map(doc => {
    const t = doc.data();
    const ts = t.createdAt;
    const secs = ts && typeof ts === 'object' && ('seconds' in ts || '_seconds' in ts)
      ? (ts.seconds ?? ts._seconds)
      : null;
    return {
      direction: t.direction,
      shares: t.shares,
      cost: t.cost,
      consensus: t.consensus ?? null,
      createdAt: secs,
    };
  }));
}));

predictionsRouter.get('/markets/:id', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const doc = await wsCol(workspaceId, 'markets').doc(req.params.id as string).get();
  if (!doc.exists) { res.status(404).json({ error: 'Market not found' }); return; }
  const m = doc.data()!;
  const prob = pHigher(m.shares, m.liquidity);
  res.json({
    id: doc.id,
    metricId: m.metricId,
    metricName: m.metricName,
    targetDate: m.targetDate,
    resolved: m.resolved,
    rangeMin: m.rangeMin,
    rangeMax: m.rangeMax,
    liquidity: m.liquidity,
    probability: Math.round(prob * 10000) / 10000,
    consensus: consensus(m.shares, m.liquidity, m.rangeMin, m.rangeMax) ?? null,
    costToMoveUp1pct: directionTradeCost(m.shares, 1, m.liquidity * 0.01, m.liquidity),
  });
}));

predictionsRouter.get('/markets/:id/context', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const doc = await wsCol(workspaceId, 'markets').doc(req.params.id as string).get();
  if (!doc.exists) { res.status(404).json({ error: 'Market not found' }); return; }
  const m = doc.data()!;

  const historyLimit = typeof req.query.historyLimit === 'string' ? Math.min(parseInt(req.query.historyLimit, 10), 90) : 20;
  const updatesLimit = typeof req.query.updatesLimit === 'string' ? Math.min(parseInt(req.query.updatesLimit, 10), 30) : 10;

  const metrics = await getAllMetrics(workspaceId);
  const metric = metrics.find(mt => mt.id === m.metricId);
  const deps = metric ? extractMetricReferences(metric.formula || '0') : [];
  const depValues = deps.map(name => {
    const d = metrics.find(mt => mt.name === name);
    return { name, value: d?.value ?? null };
  });

  const [logs, updates, relatedSnap] = await Promise.all([
    metric ? getMetricLogs(metric.id, workspaceId) : Promise.resolve([]),
    getUpdates(200, workspaceId),
    wsCol(workspaceId, 'markets')
      .where('metricId', '==', m.metricId)
      .where('resolved', '==', false)
      .get(),
  ]);

  const metricUpdates = metric
    ? updates.filter(u => u.metricName === metric.name)
    : [];

  const relatedMarkets = relatedSnap.docs
    .filter(d => d.id !== doc.id)
    .map(d => {
      const rm = d.data();
      return {
        id: d.id, targetDate: rm.targetDate,
        consensus: consensus(rm.shares, rm.liquidity, rm.rangeMin, rm.rangeMax) ?? null,
        probability: Math.round(pHigher(rm.shares, rm.liquidity) * 10000) / 10000,
      };
    });

  const shares: [number, number] = m.shares || [0, 0];
  res.json({
    market: {
      id: doc.id, metricName: m.metricName,
      targetDate: m.targetDate, rangeMin: m.rangeMin, rangeMax: m.rangeMax,
      probability: Math.round(pHigher(shares, m.liquidity) * 10000) / 10000,
      consensus: consensus(shares, m.liquidity, m.rangeMin, m.rangeMax) ?? null,
    },
    metric: metric ? {
      name: metric.name, formula: metric.formula,
      currentValue: metric.value, currentTotal: metric.total,
      dependencies: depValues,
    } : null,
    history: logs.slice(-historyLimit).map(l => ({ value: l.value, timestamp: l.timestamp })),
    recentUpdates: metricUpdates.slice(0, updatesLimit).map(u => ({
      oldValue: u.oldValue, newValue: u.newValue, description: u.description, timestamp: u.timestamp,
    })),
    relatedMarkets,
  });
}));

// --- Admin-only ---

predictionsRouter.post('/markets', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const { metricId, targetDate, rangeMin, rangeMax, liquidity } = req.body;
  if (!metricId || typeof metricId !== 'string') { res.status(400).json({ error: 'metricId is required' }); return; }
  if (!targetDate || typeof targetDate !== 'string' || !isValidDateFormat(targetDate)) { res.status(400).json({ error: 'targetDate must be YYYY, YYYY-MM, YYYY-Www, or YYYY-MM-DD' }); return; }

  const today = new Date().toISOString().slice(0, 10);
  if (endOfPeriod(targetDate) <= today) { res.status(400).json({ error: 'targetDate period must be in the future' }); return; }

  const metrics = await getAllMetrics(workspaceId);
  const metric = metrics.find(m => m.id === metricId);
  if (!metric) { res.status(404).json({ error: 'Metric not found' }); return; }

  const existing = await wsCol(workspaceId, 'markets')
    .where('metricId', '==', metricId)
    .where('targetDate', '==', targetDate)
    .limit(1)
    .get();
  if (!existing.empty) { res.status(409).json({ error: 'Market already exists' }); return; }

  const rMin = typeof rangeMin === 'number' ? rangeMin : AMM_DEFAULTS.rangeMin;
  const rMax = typeof rangeMax === 'number' ? rangeMax : (metric.marketRangeMax ?? AMM_DEFAULTS.rangeMax);
  const liq = typeof liquidity === 'number' ? liquidity : AMM_DEFAULTS.liquidity;

  const ref = wsCol(workspaceId, 'markets').doc();
  await ref.set({
    id: ref.id,
    metricId,
    metricName: metric.name,
    targetDate,
    resolved: false,
    resolvedAt: null,
    actualValue: null,
    createdAt: FieldValue.serverTimestamp(),
    rangeMin: rMin,
    rangeMax: rMax,
    shares: [0, 0],
    liquidity: liq,
    pool: initialPool(liq),
  });

  const liqRef = wsCol(workspaceId, 'liquidityEvents').doc();
  await liqRef.set({ id: liqRef.id, marketId: ref.id, amount: liq, totalLiquidity: liq, type: 'initial', createdAt: FieldValue.serverTimestamp() });

  res.status(201).json({ id: ref.id, metricId, metricName: metric.name, targetDate });
  emitEvent('market:created', { marketId: ref.id, metricName: metric.name, targetDate }, workspaceId).catch(e => console.error('emitEvent failed:', e));
}));

predictionsRouter.get('/markets/:id/liquidity-events', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const snap = await wsCol(workspaceId, 'liquidityEvents')
    .where('marketId', '==', req.params.id as string)
    .get();
  res.json(snap.docs.map(doc => {
    const d = doc.data();
    const ts = d.createdAt;
    const secs = ts && typeof ts === 'object' && ('seconds' in ts || '_seconds' in ts)
      ? (ts.seconds ?? ts._seconds)
      : null;
    return { id: d.id, amount: d.amount, totalLiquidity: d.totalLiquidity, type: d.type, createdAt: secs != null ? { _seconds: secs } : null };
  }));
}));

predictionsRouter.post('/markets/liquidity/bulk', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId, agentId: callerAgentId } = req.auth!;
  const { amount, agentId: bodyAgentId, taskId } = req.body;
  if (typeof amount !== 'number' || amount <= 0) { res.status(400).json({ error: 'amount must be a positive number' }); return; }
  const agentId = (typeof bodyAgentId === 'string' && bodyAgentId) ? bodyAgentId : callerAgentId;
  if (!agentId) { res.status(400).json({ error: 'agentId is required (or link an agent to your account)' }); return; }

  const agentRef = db().collection('agents').doc(agentId);
  let marketsQuery: FirebaseFirestore.Query = wsCol(workspaceId, 'markets').where('active', '==', true).where('resolved', '==', false);
  if (typeof taskId === 'string' && taskId) {
    marketsQuery = marketsQuery.where('taskId', '==', taskId);
  }
  const [agentDoc, marketsSnap] = await Promise.all([agentRef.get(), marketsQuery.get()]);
  if (!agentDoc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }

  const balance = fromUnits(agentDoc.data()!.balance as number);
  const marketDocs = taskId
    ? marketsSnap.docs
    : marketsSnap.docs.filter(d => !d.data().taskId);
  const marketCount = marketDocs.length;
  if (marketCount === 0) { res.status(400).json({ error: 'No active markets' }); return; }

  // Compute actual pool increases per market (what LP actually funds)
  type MarketUpdate = {
    doc: FirebaseFirestore.QueryDocumentSnapshot;
    newLiquidity: number;
    newShares: [number, number];
    newPool: number;
    poolContribution: number;
  };
  const updates: MarketUpdate[] = marketDocs.map(marketDoc => {
    const data = marketDoc.data();
    const oldLiquidity = data.liquidity as number;
    const oldShares = data.shares as [number, number];
    const oldPool = (data.pool as number) ?? 0;
    const newLiquidity = oldLiquidity + amount;
    const newShares: [number, number] = oldLiquidity > 0
      ? [Math.round(oldShares[0] * newLiquidity / oldLiquidity * 100) / 100, Math.round(oldShares[1] * newLiquidity / oldLiquidity * 100) / 100]
      : [0, 0];
    const newPool = oldLiquidity > 0
      ? Math.round(oldPool * newLiquidity / oldLiquidity * 100) / 100
      : initialPool(newLiquidity);
    const poolContribution = Math.round((newPool - oldPool) * 100) / 100;
    return { doc: marketDoc, newLiquidity, newShares, newPool, poolContribution };
  });

  const totalCost = Math.round(updates.reduce((s, u) => s + u.poolContribution, 0) * 100) / 100;
  if (!sufficientBalance(balance, totalCost)) { res.status(400).json({ error: `Insufficient balance: need ${totalCost}, have ${balance}` }); return; }

  const batch = db().batch();
  batch.update(agentRef, { balance: FieldValue.increment(-toUnits(totalCost)), spentBetting: FieldValue.increment(totalCost) });

  for (const { doc: marketDoc, newLiquidity, newShares, newPool, poolContribution } of updates) {
    batch.update(marketDoc.ref, { liquidity: newLiquidity, shares: newShares, pool: newPool });
    const liqRef = wsCol(workspaceId, 'liquidityEvents').doc();
    batch.set(liqRef, { id: liqRef.id, marketId: marketDoc.id, agentId, amount, poolContribution, totalLiquidity: newLiquidity, type: 'injection', createdAt: FieldValue.serverTimestamp() });
  }

  await batch.commit();
  res.json({ markets: marketCount, totalCost, amountPerMarket: amount });
}));

predictionsRouter.post('/markets/:id/liquidity', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const { amount, agentId } = req.body;
  if (typeof amount !== 'number' || amount <= 0) { res.status(400).json({ error: 'amount must be a positive number' }); return; }
  if (typeof agentId !== 'string' || !agentId) { res.status(400).json({ error: 'agentId is required' }); return; }

  const [marketDoc, agentDoc] = await Promise.all([
    wsCol(workspaceId, 'markets').doc(req.params.id as string).get(),
    db().collection('agents').doc(agentId).get(),
  ]);
  if (!marketDoc.exists) { res.status(404).json({ error: 'Market not found' }); return; }
  if (!agentDoc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }

  const data = marketDoc.data()!;
  const oldLiquidity = data.liquidity as number;
  const oldShares = data.shares as [number, number];
  const oldPool = (data.pool as number) ?? 0;
  const newLiquidity = oldLiquidity + amount;
  const newShares: [number, number] = oldLiquidity > 0
    ? [Math.round(oldShares[0] * newLiquidity / oldLiquidity * 100) / 100, Math.round(oldShares[1] * newLiquidity / oldLiquidity * 100) / 100]
    : [0, 0];
  const newPool = oldLiquidity > 0
    ? Math.round(oldPool * newLiquidity / oldLiquidity * 100) / 100
    : initialPool(newLiquidity);
  const poolContribution = Math.round((newPool - oldPool) * 100) / 100;

  const balanceUnits = agentDoc.data()!.balance as number;
  if (!sufficientBalance(balanceUnits, poolContribution)) { res.status(400).json({ error: `Insufficient balance: need ${poolContribution}, have ${fromUnits(balanceUnits)}` }); return; }

  const batch = db().batch();
  batch.update(marketDoc.ref, { liquidity: newLiquidity, shares: newShares, pool: newPool });
  batch.update(db().collection('agents').doc(agentId), { balance: FieldValue.increment(-toUnits(poolContribution)), spentBetting: FieldValue.increment(poolContribution) });
  const liqRef = wsCol(workspaceId, 'liquidityEvents').doc();
  batch.set(liqRef, { id: liqRef.id, marketId: req.params.id as string, agentId, amount, poolContribution, totalLiquidity: newLiquidity, type: 'injection', createdAt: FieldValue.serverTimestamp() });
  await batch.commit();
  res.json({ liquidity: newLiquidity, poolContribution });
}));

predictionsRouter.post('/markets/:id/void', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const result = await voidMarket(req.params.id as string, workspaceId);
  res.json(result);
}));

predictionsRouter.post('/markets/:id/resolve', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const result = await resolveMarket(req.params.id as string, workspaceId);
  res.json(result);
}));

predictionsRouter.delete('/markets/:id', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const ref = wsCol(workspaceId, 'markets').doc(req.params.id as string);
  const doc = await ref.get();
  if (!doc.exists) { res.status(404).json({ error: 'Market not found' }); return; }
  await ref.delete();
  res.status(204).send();
}));

predictionsRouter.post('/resolve', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const { targetDate } = req.body || {};
  const result = await resolvePredictions(targetDate, workspaceId);
  res.json(result);
}));

predictionsRouter.post('/markets/refresh', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const taskId = typeof req.body?.taskId === 'string' ? req.body.taskId : undefined;
  if (taskId) {
    const taskRef = wsCol(workspaceId, 'tasks').doc(taskId);
    const taskDoc = await taskRef.get();
    if (!taskDoc.exists) { res.status(404).json({ error: 'Task not found' }); return; }
    const existingIds: string[] = taskDoc.data()!.conditionalMarketIds ?? [];
    const marketIds = await createConditionalMarkets(taskId, workspaceId);
    await taskRef.update({ conditionalMarketIds: marketIds });
    const reused = existingIds.length > 0 && existingIds.length === marketIds.length &&
      existingIds.every(id => marketIds.includes(id));
    res.json({ created: reused ? 0 : marketIds.length, deactivated: 0, deduplicated: 0 });
    return;
  }
  const result = await refreshRelativeDateMarkets(workspaceId);
  res.json(result);
}));

// Emit market:created for existing open markets of a metric (so hook watchers notify agents).
predictionsRouter.post('/markets/notify', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const { metricId, metricName } = req.body || {};
  if (!metricId && !metricName) {
    res.status(400).json({ error: 'metricId or metricName is required' });
    return;
  }
  let targetMetricId: string | null = metricId ?? null;
  if (!targetMetricId && metricName) {
    const metrics = await getAllMetrics(workspaceId);
    const m = metrics.find(x => x.name === metricName);
    if (!m) { res.status(404).json({ error: 'Metric not found' }); return; }
    targetMetricId = m.id;
  }
  const snap = await wsCol(workspaceId, 'markets')
    .where('metricId', '==', targetMetricId!)
    .where('resolved', '==', false)
    .get();
  let emitted = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    await emitEvent('market:created', { marketId: doc.id, metricName: d.metricName, targetDate: d.targetDate }, workspaceId);
    emitted++;
  }
  res.json({ emitted });
}));

// One-time migration: add binary AMM fields to existing markets, refund old predictions
predictionsRouter.post('/migrate', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const marketsSnap = await wsCol(workspaceId, 'markets').get();
  const predsSnap = await wsCol(workspaceId, 'predictions' as never).where('resolved', '==', false).get();

  let marketsUpdated = 0;
  let poolsBackfilled = 0;
  let predictionsResolved = 0;
  let refunded = 0;
  const agentRefunds = new Map<string, number>();

  for (const doc of marketsSnap.docs) {
    const m = doc.data();
    if (m.shares && Array.isArray(m.shares) && m.shares.length === 2) {
      if (m.pool == null && !m.resolved) {
        const b = m.liquidity as number;
        const shares = m.shares as [number, number];
        const pool = b > 0 ? Math.round(lmsrCost(shares, b) * 100) / 100 : 0;
        await doc.ref.update({ pool });
        poolsBackfilled++;
      }
      continue;
    }
    await doc.ref.update({
      rangeMin: m.rangeMin ?? AMM_DEFAULTS.rangeMin,
      rangeMax: m.rangeMax ?? AMM_DEFAULTS.rangeMax,
      shares: [0, 0],
      liquidity: m.liquidity ?? AMM_DEFAULTS.liquidity,
      pool: initialPool(m.liquidity ?? AMM_DEFAULTS.liquidity),
    });
    marketsUpdated++;
  }

  for (const doc of predsSnap.docs) {
    const pred = doc.data();
    await doc.ref.update({ resolved: true, resolvedAt: FieldValue.serverTimestamp(), actualValue: null, payout: pred.stake });
    agentRefunds.set(pred.agentId, (agentRefunds.get(pred.agentId) || 0) + pred.stake);
    predictionsResolved++;
    refunded += pred.stake;
  }

  for (const [agentId, amount] of agentRefunds) {
    await db().collection('agents').doc(agentId).update({
      balance: FieldValue.increment(toUnits(amount)),
      earnedBetting: FieldValue.increment(amount),
    });
  }

  res.json({ marketsUpdated, poolsBackfilled, predictionsResolved, refunded });
}));
