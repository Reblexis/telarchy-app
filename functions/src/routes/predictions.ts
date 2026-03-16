import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../lib/db';
import { wrap } from '../lib/wrap';
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

export const predictionsRouter = Router();

predictionsRouter.use(authMiddleware);

// --- Agent-accessible ---

predictionsRouter.post('/trade', requireRole('agent', 'admin'), wrap(async (req, res) => {
  // Admin can impersonate an agent
  let agentId = req.auth!.agentId;
  if (req.body.agentId && req.auth!.role === 'admin') {
    agentId = req.body.agentId;
  }
  if (!agentId) { res.status(403).json({ error: 'Only agents can trade' }); return; }

  const { marketId } = req.body;
  if (!marketId || typeof marketId !== 'string') { res.status(400).json({ error: 'marketId is required' }); return; }

  const marketRef = db().collection('markets').doc(marketId);
  const marketDoc = await marketRef.get();
  if (!marketDoc.exists) { res.status(404).json({ error: 'Market not found' }); return; }
  const market = marketDoc.data()!;
  if (market.resolved) { res.status(400).json({ error: 'Market is resolved' }); return; }
  if (market.active === false) { res.status(400).json({ error: 'Market is inactive' }); return; }

  const shares: [number, number] = market.shares;
  const b = market.liquidity;
  if (b <= 0) { res.status(400).json({ error: 'Market has no liquidity — admin must inject liquidity before trading' }); return; }
  let direction: 0 | 1;
  let amount: number;
  let cost = 0;
  let isSell = false;

  const targetValue = req.body.targetValue ?? req.body.value;
  const maxBudget = req.body.maxBudget ?? req.body.amount;
  if (typeof targetValue === 'number' && typeof maxBudget === 'number') {
    // Mode: bet towards value — buy shares to move consensus to targetValue, capped by maxBudget
    if (maxBudget <= 0) { res.status(400).json({ error: 'maxBudget/amount must be positive' }); return; }
    if (targetValue < market.rangeMin || targetValue > market.rangeMax) {
      res.status(400).json({ error: `targetValue/value must be between ${market.rangeMin} and ${market.rangeMax}` }); return;
    }
    const result = betTowardsValue(shares, b, market.rangeMin, market.rangeMax, targetValue, maxBudget);
    direction = result.direction; amount = result.amount; cost = result.cost;
  } else if (typeof req.body.direction === 'string' && typeof req.body.sellShares === 'number') {
    // Mode: sell shares
    if (req.body.direction !== 'higher' && req.body.direction !== 'lower') {
      res.status(400).json({ error: 'direction must be "higher" or "lower"' }); return;
    }
    if (req.body.sellShares <= 0) { res.status(400).json({ error: 'sellShares must be positive' }); return; }
    direction = req.body.direction === 'higher' ? 1 : 0;
    amount = req.body.sellShares;
    isSell = true;
  } else if (typeof req.body.direction === 'string' && typeof req.body.amount === 'number') {
    // Mode: bet higher/lower
    if (req.body.direction !== 'higher' && req.body.direction !== 'lower') {
      res.status(400).json({ error: 'direction must be "higher" or "lower"' }); return;
    }
    if (req.body.amount <= 0) { res.status(400).json({ error: 'amount must be positive' }); return; }
    direction = req.body.direction === 'higher' ? 1 : 0;
    const result = sharesForBudget(shares, direction, req.body.amount, b);
    amount = result.amount; cost = result.cost;
  } else {
    res.status(400).json({ error: 'Provide {targetValue, maxBudget}, {direction, amount}, or {direction, sellShares}' }); return;
  }

  if (amount <= 0) { res.status(400).json({ error: 'Trade too small' }); return; }

  const dirLabel = direction === 1 ? 'higher' : 'lower';
  const agentRef = db().collection('agents').doc(agentId);
  const posId = `${agentId}_${marketId}_${dirLabel}`;
  const posRef = db().collection('positions').doc(posId);

  const [agentDoc, posDoc] = await Promise.all([agentRef.get(), posRef.get()]);
  if (!agentDoc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }
  const balance = agentDoc.data()!.balance as number;

  let proceeds = 0;
  if (isSell) {
    const posShares = posDoc.exists ? (posDoc.data()!.shares as number) : 0;
    if (posShares < amount) { res.status(400).json({ error: 'Insufficient shares to sell', available: posShares }); return; }
    proceeds = directionSellProceeds(shares, direction, amount, b);
    if (proceeds <= 0) { res.status(400).json({ error: 'Trade too small' }); return; }
  } else {
    if (cost > 0 && balance < cost) { res.status(400).json({ error: 'Insufficient balance', balance, cost }); return; }
  }

  const newShares: [number, number] = [shares[0], shares[1]];
  newShares[direction] += isSell ? -amount : amount;

  const newConsensus = consensus(newShares, b, market.rangeMin, market.rangeMax) ?? null;
  const newProbability = Math.round(pHigher(newShares, b) * 10000) / 10000;

  const tradeRef = db().collection('trades').doc();
  const batch = db().batch();

  if (isSell) {
    batch.update(marketRef, { shares: newShares, pool: FieldValue.increment(-proceeds) });
    batch.update(agentRef, { balance: FieldValue.increment(proceeds), earnedBetting: FieldValue.increment(proceeds) });
    batch.update(posRef, { shares: FieldValue.increment(-amount) });
  } else {
    batch.update(marketRef, { shares: newShares, pool: FieldValue.increment(cost) });
    batch.update(agentRef, { balance: FieldValue.increment(-cost), spentBetting: FieldValue.increment(cost) });
    if (posDoc.exists) {
      batch.update(posRef, { shares: FieldValue.increment(amount), totalCost: FieldValue.increment(cost) });
    } else {
      batch.set(posRef, { id: posId, agentId, marketId, direction: dirLabel, shares: amount, totalCost: cost });
    }
  }

  batch.set(tradeRef, {
    id: tradeRef.id, agentId, marketId, direction: dirLabel,
    shares: isSell ? -amount : amount,
    cost: isSell ? -proceeds : cost,
    consensus: newConsensus, probability: newProbability,
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  const response = isSell
    ? { tradeId: tradeRef.id, marketId, direction: dirLabel, shares: amount, proceeds, probability: newProbability, consensus: newConsensus }
    : { tradeId: tradeRef.id, marketId, direction: dirLabel, shares: amount, cost, probability: newProbability, consensus: newConsensus };
  res.status(201).json(response);
  emitEvent('trade:executed', { marketId, metricName: market.metricName, agentId, direction: dirLabel, cost: isSell ? -proceeds : cost, newConsensus }).catch(e => console.error('emitEvent failed:', e));
}));

predictionsRouter.get('/positions', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const agentId = req.auth!.role === 'admin' && typeof req.query.agentId === 'string'
    ? req.query.agentId
    : req.auth!.agentId;
  if (!agentId) { res.status(403).json({ error: 'Only agents can list positions' }); return; }

  let query: FirebaseFirestore.Query = db().collection('positions').where('agentId', '==', agentId);
  if (req.query.marketId) query = query.where('marketId', '==', req.query.marketId as string);

  const snapshot = await query.get();
  res.json(snapshot.docs.map(doc => doc.data()).filter((p: Record<string, unknown>) => (p.shares as number) > 0));
}));

predictionsRouter.get('/markets', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const taskId = typeof req.query.taskId === 'string' ? req.query.taskId : undefined;
  if (taskId) {
    const taskRef = db().collection('tasks').doc(taskId);
    const taskDoc = await taskRef.get();
    if (taskDoc.exists) {
      const task = taskDoc.data()!;
      if (!task.conditionalMarketIds?.length) {
        const marketIds = await createConditionalMarkets(taskId);
        await taskRef.update({ conditionalMarketIds: marketIds });
      }
    }
  }
  res.json(await getMarkets(false, taskId));
}));

predictionsRouter.get('/markets/:id/trades', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const snap = await db().collection('trades')
    .where('marketId', '==', req.params.id as string)
    .orderBy('createdAt', 'asc')
    .get();
  res.json(snap.docs.map(doc => {
    const t = doc.data();
    const ts = t.createdAt;
    const secs = ts && typeof ts === 'object' && ('seconds' in ts || '_seconds' in ts)
      ? (ts.seconds ?? ts._seconds)
      : null;
    return {
      id: t.id,
      agentId: t.agentId,
      direction: t.direction,
      shares: t.shares,
      cost: t.cost,
      consensus: t.consensus ?? null,
      probability: t.probability ?? null,
      createdAt: secs != null ? { _seconds: secs } : null,
    };
  }));
}));

predictionsRouter.get('/markets/:id', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const doc = await db().collection('markets').doc(req.params.id as string).get();
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
  const doc = await db().collection('markets').doc(req.params.id as string).get();
  if (!doc.exists) { res.status(404).json({ error: 'Market not found' }); return; }
  const m = doc.data()!;

  const metrics = await getAllMetrics();
  const metric = metrics.find(mt => mt.id === m.metricId);
  const deps = metric ? extractMetricReferences(metric.formula || '0') : [];
  const depValues = deps.map(name => {
    const d = metrics.find(mt => mt.name === name);
    return { name, value: d?.value ?? null, total: d?.total ?? null };
  });

  const [logs, updates, relatedSnap] = await Promise.all([
    metric ? getMetricLogs(metric.id) : Promise.resolve([]),
    getUpdates(50),
    db().collection('markets')
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

  res.json({
    market: {
      id: doc.id, metricId: m.metricId, metricName: m.metricName,
      targetDate: m.targetDate, rangeMin: m.rangeMin, rangeMax: m.rangeMax,
      liquidity: m.liquidity,
      probability: Math.round(pHigher(m.shares, m.liquidity) * 10000) / 10000,
      consensus: consensus(m.shares, m.liquidity, m.rangeMin, m.rangeMax) ?? null,
    },
    metric: metric ? {
      name: metric.name, formula: metric.formula,
      currentValue: metric.value, currentTotal: metric.total,
      dependencies: depValues,
    } : null,
    history: logs.slice(-90),
    recentUpdates: metricUpdates.slice(0, 30),
    relatedMarkets,
  });
}));

// --- Admin-only ---

predictionsRouter.post('/markets', requireRole('admin'), wrap(async (req, res) => {
  const { metricId, targetDate, rangeMin, rangeMax, liquidity } = req.body;
  if (!metricId || typeof metricId !== 'string') { res.status(400).json({ error: 'metricId is required' }); return; }
  if (!targetDate || typeof targetDate !== 'string' || !isValidDateFormat(targetDate)) { res.status(400).json({ error: 'targetDate must be YYYY, YYYY-MM, YYYY-Www, or YYYY-MM-DD' }); return; }

  const today = new Date().toISOString().slice(0, 10);
  if (endOfPeriod(targetDate) <= today) { res.status(400).json({ error: 'targetDate period must be in the future' }); return; }

  const metrics = await getAllMetrics();
  const metric = metrics.find(m => m.id === metricId);
  if (!metric) { res.status(404).json({ error: 'Metric not found' }); return; }

  const existing = await db().collection('markets')
    .where('metricId', '==', metricId)
    .where('targetDate', '==', targetDate)
    .limit(1)
    .get();
  if (!existing.empty) { res.status(409).json({ error: 'Market already exists' }); return; }

  const rMin = typeof rangeMin === 'number' ? rangeMin : AMM_DEFAULTS.rangeMin;
  const rMax = typeof rangeMax === 'number' ? rangeMax : (metric.marketRangeMax ?? AMM_DEFAULTS.rangeMax);
  const liq = typeof liquidity === 'number' ? liquidity : AMM_DEFAULTS.liquidity;

  const ref = db().collection('markets').doc();
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

  const liqRef = db().collection('liquidityEvents').doc();
  await liqRef.set({ id: liqRef.id, marketId: ref.id, amount: liq, totalLiquidity: liq, type: 'initial', createdAt: FieldValue.serverTimestamp() });

  res.status(201).json({ id: ref.id, metricId, metricName: metric.name, targetDate });
  emitEvent('market:created', { marketId: ref.id, metricName: metric.name, targetDate }).catch(e => console.error('emitEvent failed:', e));
}));

predictionsRouter.get('/markets/:id/liquidity-events', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const snap = await db().collection('liquidityEvents')
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

predictionsRouter.post('/markets/:id/liquidity', requireRole('admin'), wrap(async (req, res) => {
  const { amount } = req.body;
  if (typeof amount !== 'number' || amount <= 0) { res.status(400).json({ error: 'amount must be a positive number' }); return; }
  const ref = db().collection('markets').doc(req.params.id as string);
  const doc = await ref.get();
  if (!doc.exists) { res.status(404).json({ error: 'Market not found' }); return; }
  const data = doc.data()!;
  const oldLiquidity = data.liquidity as number;
  const oldShares = data.shares as [number, number];
  const oldPool = (data.pool as number) ?? 0;
  const newLiquidity = oldLiquidity + amount;
  const newShares: [number, number] = oldLiquidity > 0
    ? [oldShares[0] * newLiquidity / oldLiquidity, oldShares[1] * newLiquidity / oldLiquidity]
    : [0, 0];
  const newPool = oldLiquidity > 0
    ? Math.round(oldPool * newLiquidity / oldLiquidity * 100) / 100
    : initialPool(newLiquidity);
  await ref.update({ liquidity: newLiquidity, shares: newShares, pool: newPool });
  const liqRef = db().collection('liquidityEvents').doc();
  await liqRef.set({ id: liqRef.id, marketId: req.params.id as string, amount, totalLiquidity: newLiquidity, type: 'injection', createdAt: FieldValue.serverTimestamp() });
  res.json({ liquidity: newLiquidity });
}));

predictionsRouter.post('/markets/:id/void', requireRole('admin'), wrap(async (req, res) => {
  const result = await voidMarket(req.params.id as string);
  res.json(result);
}));

predictionsRouter.post('/markets/:id/resolve', requireRole('admin'), wrap(async (req, res) => {
  const result = await resolveMarket(req.params.id as string);
  res.json(result);
}));

predictionsRouter.delete('/markets/:id', requireRole('admin'), wrap(async (req, res) => {
  const ref = db().collection('markets').doc(req.params.id as string);
  const doc = await ref.get();
  if (!doc.exists) { res.status(404).json({ error: 'Market not found' }); return; }
  await ref.delete();
  res.status(204).send();
}));

predictionsRouter.post('/resolve', requireRole('admin'), wrap(async (req, res) => {
  const { targetDate } = req.body || {};
  const result = await resolvePredictions(targetDate);
  res.json(result);
}));

predictionsRouter.post('/markets/refresh', requireRole('admin'), wrap(async (req, res) => {
  const taskId = typeof req.body?.taskId === 'string' ? req.body.taskId : undefined;
  if (taskId) {
    const taskRef = db().collection('tasks').doc(taskId);
    const taskDoc = await taskRef.get();
    if (!taskDoc.exists) { res.status(404).json({ error: 'Task not found' }); return; }
    const existingIds: string[] = taskDoc.data()!.conditionalMarketIds ?? [];
    const marketIds = await createConditionalMarkets(taskId);
    await taskRef.update({ conditionalMarketIds: marketIds });
    const reused = existingIds.length > 0 && existingIds.length === marketIds.length &&
      existingIds.every(id => marketIds.includes(id));
    res.json({ created: reused ? 0 : marketIds.length, deactivated: 0, deduplicated: 0 });
    return;
  }
  const result = await refreshRelativeDateMarkets();
  res.json(result);
}));

// Emit market:created for existing open markets of a metric (so hook watchers notify agents).
predictionsRouter.post('/markets/notify', requireRole('admin'), wrap(async (req, res) => {
  const { metricId, metricName } = req.body || {};
  if (!metricId && !metricName) {
    res.status(400).json({ error: 'metricId or metricName is required' });
    return;
  }
  let targetMetricId: string | null = metricId ?? null;
  if (!targetMetricId && metricName) {
    const metrics = await getAllMetrics();
    const m = metrics.find(x => x.name === metricName);
    if (!m) { res.status(404).json({ error: 'Metric not found' }); return; }
    targetMetricId = m.id;
  }
  const snap = await db().collection('markets')
    .where('metricId', '==', targetMetricId!)
    .where('resolved', '==', false)
    .get();
  let emitted = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    await emitEvent('market:created', { marketId: doc.id, metricName: d.metricName, targetDate: d.targetDate });
    emitted++;
  }
  res.json({ emitted });
}));

// One-time migration: add binary AMM fields to existing markets, refund old predictions
predictionsRouter.post('/migrate', requireRole('admin'), wrap(async (_req, res) => {
  const marketsSnap = await db().collection('markets').get();
  const predsSnap = await db().collection('predictions').where('resolved', '==', false).get();

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
      balance: FieldValue.increment(amount),
      earnedBetting: FieldValue.increment(amount),
    });
  }

  res.json({ marketsUpdated, poolsBackfilled, predictionsResolved, refunded });
}));
