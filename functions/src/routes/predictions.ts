import { Router } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { wrap } from '../lib/wrap';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { getAllMetrics } from '../services/metrics';
import { resolvePredictions, getMarkets } from '../services/predictions';
import { refreshRelativeDateMarkets } from '../services/markets';
import { isValidDateFormat, endOfPeriod } from '../lib/date-utils';
import { consensus, pHigher, directionTradeCost, sharesForBudget, betOnValue, AMM_DEFAULTS } from '../lib/amm';
import { emitEvent } from '../services/events';

function db() { return getFirestore(); }

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

  const shares: [number, number] = market.shares;
  let direction: 0 | 1;
  let amount: number;
  let cost: number;

  if (typeof req.body.value === 'number' && typeof req.body.amount === 'number') {
    // Mode: bet on value — system picks direction
    if (req.body.amount <= 0) { res.status(400).json({ error: 'amount must be positive' }); return; }
    const result = betOnValue(shares, market.liquidity, market.rangeMin, market.rangeMax, req.body.value, req.body.amount);
    direction = result.direction;
    amount = result.amount;
    cost = result.cost;
  } else if (typeof req.body.direction === 'string' && typeof req.body.amount === 'number') {
    // Mode: bet higher/lower
    if (req.body.direction !== 'higher' && req.body.direction !== 'lower') {
      res.status(400).json({ error: 'direction must be "higher" or "lower"' }); return;
    }
    if (req.body.amount <= 0) { res.status(400).json({ error: 'amount must be positive' }); return; }
    direction = req.body.direction === 'higher' ? 1 : 0;
    const result = sharesForBudget(shares, direction, req.body.amount, market.liquidity);
    amount = result.amount;
    cost = result.cost;
  } else {
    res.status(400).json({ error: 'Provide {value, amount} or {direction: "higher"|"lower", amount}' }); return;
  }

  if (amount <= 0) { res.status(400).json({ error: 'Trade too small' }); return; }

  // Check agent balance
  const agentRef = db().collection('agents').doc(agentId);
  const agentDoc = await agentRef.get();
  if (!agentDoc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }
  const balance = agentDoc.data()!.balance as number;
  if (cost > 0 && balance < cost) { res.status(400).json({ error: 'Insufficient balance', balance, cost }); return; }

  // Execute trade
  const dirLabel = direction === 1 ? 'higher' : 'lower';
  const newShares: [number, number] = [shares[0], shares[1]];
  newShares[direction] += amount;

  const posId = `${agentId}_${marketId}_${dirLabel}`;
  const posRef = db().collection('positions').doc(posId);
  const tradeRef = db().collection('trades').doc();
  const batch = db().batch();

  batch.update(marketRef, { shares: newShares });
  batch.update(agentRef, {
    balance: FieldValue.increment(-cost),
    spentBetting: FieldValue.increment(cost),
  });

  const posDoc = await posRef.get();
  if (posDoc.exists) {
    batch.update(posRef, { shares: FieldValue.increment(amount), totalCost: FieldValue.increment(cost) });
  } else {
    batch.set(posRef, { id: posId, agentId, marketId, direction: dirLabel, shares: amount, totalCost: cost });
  }

  const newConsensus = consensus(newShares, market.liquidity, market.rangeMin, market.rangeMax);
  const newProbability = Math.round(pHigher(newShares, market.liquidity) * 10000) / 10000;

  batch.set(tradeRef, { id: tradeRef.id, agentId, marketId, direction: dirLabel, shares: amount, cost, consensus: newConsensus, probability: newProbability, createdAt: FieldValue.serverTimestamp() });

  await batch.commit();

  res.status(201).json({ tradeId: tradeRef.id, marketId, direction: dirLabel, shares: amount, cost, probability: newProbability, consensus: newConsensus });
  emitEvent('trade:executed', { marketId, metricName: market.metricName, agentId, direction: dirLabel, cost, newConsensus }).catch(() => {});
}));

predictionsRouter.get('/positions', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const agentId = req.auth!.agentId;
  if (!agentId) { res.status(403).json({ error: 'Only agents can list positions' }); return; }

  let query: FirebaseFirestore.Query = db().collection('positions').where('agentId', '==', agentId);
  if (req.query.marketId) query = query.where('marketId', '==', req.query.marketId as string);

  const snapshot = await query.get();
  res.json(snapshot.docs.map(doc => doc.data()).filter((p: Record<string, unknown>) => (p.shares as number) > 0));
}));

predictionsRouter.get('/markets', requireRole('agent', 'admin'), wrap(async (_req, res) => {
  res.json(await getMarkets());
}));

predictionsRouter.get('/markets/:id/trades', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const snap = await db().collection('trades')
    .where('marketId', '==', req.params.id as string)
    .orderBy('createdAt', 'asc')
    .get();
  res.json(snap.docs.map(doc => {
    const t = doc.data();
    return {
      id: t.id,
      agentId: t.agentId,
      direction: t.direction,
      shares: t.shares,
      cost: t.cost,
      consensus: t.consensus ?? null,
      probability: t.probability ?? null,
      createdAt: t.createdAt,
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
    consensus: consensus(m.shares, m.liquidity, m.rangeMin, m.rangeMax),
    costToMoveUp1pct: directionTradeCost(m.shares, 1, m.liquidity * 0.01, m.liquidity),
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
  const rMax = typeof rangeMax === 'number' ? rangeMax : AMM_DEFAULTS.rangeMax;
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
  });

  res.status(201).json({ id: ref.id, metricId, metricName: metric.name, targetDate });
  emitEvent('market:created', { marketId: ref.id, metricName: metric.name, targetDate }).catch(() => {});
}));

predictionsRouter.post('/markets/:id/liquidity', requireRole('admin'), wrap(async (req, res) => {
  const { amount } = req.body;
  if (typeof amount !== 'number' || amount <= 0) { res.status(400).json({ error: 'amount must be a positive number' }); return; }
  const ref = db().collection('markets').doc(req.params.id as string);
  const doc = await ref.get();
  if (!doc.exists) { res.status(404).json({ error: 'Market not found' }); return; }
  const newLiquidity = doc.data()!.liquidity + amount;
  await ref.update({ liquidity: newLiquidity });
  res.json({ liquidity: newLiquidity });
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

predictionsRouter.post('/markets/refresh', requireRole('admin'), wrap(async (_req, res) => {
  const result = await refreshRelativeDateMarkets();
  res.json(result);
}));

// One-time migration: add binary AMM fields to existing markets, refund old predictions
predictionsRouter.post('/migrate', requireRole('admin'), wrap(async (_req, res) => {
  const marketsSnap = await db().collection('markets').get();
  const predsSnap = await db().collection('predictions').where('resolved', '==', false).get();

  let marketsUpdated = 0;
  let predictionsResolved = 0;
  let refunded = 0;
  const agentRefunds = new Map<string, number>();

  for (const doc of marketsSnap.docs) {
    const m = doc.data();
    if (m.shares && Array.isArray(m.shares) && m.shares.length === 2) continue;
    await doc.ref.update({
      rangeMin: m.rangeMin ?? AMM_DEFAULTS.rangeMin,
      rangeMax: m.rangeMax ?? AMM_DEFAULTS.rangeMax,
      shares: [0, 0],
      liquidity: m.liquidity ?? AMM_DEFAULTS.liquidity,
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

  res.json({ marketsUpdated, predictionsResolved, refunded });
}));
