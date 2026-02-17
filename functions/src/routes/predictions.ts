import { Router } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { wrap } from '../lib/wrap';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { getAllMetrics } from '../services/metrics';
import { resolvePredictions, getMarkets } from '../services/predictions';
import { refreshRelativeDateMarkets } from '../services/markets';
import { isValidDateFormat, endOfPeriod } from '../lib/date-utils';
import { tradeCost, bucketProbabilities, ammConsensus, AMM_DEFAULTS } from '../lib/amm';

function db() { return getFirestore(); }

export const predictionsRouter = Router();

// All prediction routes require auth
predictionsRouter.use(authMiddleware);

// --- Agent-accessible (role: agent or admin) ---

predictionsRouter.post('/trade', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const agentId = req.auth!.agentId;
  if (!agentId) { res.status(403).json({ error: 'Only agents can trade' }); return; }

  const { marketId, bucketIndex, shares } = req.body;
  if (!marketId || typeof marketId !== 'string') { res.status(400).json({ error: 'marketId is required' }); return; }
  if (typeof bucketIndex !== 'number' || !Number.isInteger(bucketIndex)) { res.status(400).json({ error: 'bucketIndex must be an integer' }); return; }
  if (typeof shares !== 'number' || shares === 0) { res.status(400).json({ error: 'shares must be a non-zero number' }); return; }

  // Load market
  const marketRef = db().collection('markets').doc(marketId);
  const marketDoc = await marketRef.get();
  if (!marketDoc.exists) { res.status(404).json({ error: 'Market not found' }); return; }
  const market = marketDoc.data()!;
  if (market.resolved) { res.status(400).json({ error: 'Market is resolved' }); return; }
  if (bucketIndex < 0 || bucketIndex >= market.numBuckets) { res.status(400).json({ error: `bucketIndex must be 0-${market.numBuckets - 1}` }); return; }

  // Check selling: agent must have enough shares
  if (shares < 0) {
    const posSnap = await db().collection('positions')
      .where('agentId', '==', agentId)
      .where('marketId', '==', marketId)
      .where('bucketIndex', '==', bucketIndex)
      .limit(1)
      .get();
    const currentShares = posSnap.empty ? 0 : posSnap.docs[0].data().shares;
    if (currentShares + shares < 0) { res.status(400).json({ error: 'Insufficient shares', currentShares }); return; }
  }

  // Calculate cost via LMSR
  const cost = tradeCost(market.bucketShares, bucketIndex, shares, market.liquidity);

  // Check agent balance (only for buys where cost > 0)
  const agentRef = db().collection('agents').doc(agentId);
  const agentDoc = await agentRef.get();
  if (!agentDoc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }
  const balance = agentDoc.data()!.balance as number;
  if (cost > 0 && balance < cost) { res.status(400).json({ error: 'Insufficient balance', balance, cost }); return; }

  // Execute trade atomically
  const newBucketShares = [...market.bucketShares];
  newBucketShares[bucketIndex] += shares;

  const tradeRef = db().collection('trades').doc();
  const posId = `${agentId}_${marketId}_${bucketIndex}`;
  const posRef = db().collection('positions').doc(posId);

  const batch = db().batch();

  // Update market bucket shares
  batch.update(marketRef, { bucketShares: newBucketShares });

  // Update agent balance
  if (cost > 0) {
    batch.update(agentRef, {
      balance: FieldValue.increment(-cost),
      spentBetting: FieldValue.increment(cost),
    });
  } else if (cost < 0) {
    batch.update(agentRef, {
      balance: FieldValue.increment(-cost),
      earnedBetting: FieldValue.increment(-cost),
    });
  }

  // Upsert position
  const posDoc = await posRef.get();
  if (posDoc.exists) {
    batch.update(posRef, {
      shares: FieldValue.increment(shares),
      totalCost: FieldValue.increment(cost),
    });
  } else {
    batch.set(posRef, {
      id: posId,
      agentId,
      marketId,
      bucketIndex,
      shares,
      totalCost: cost,
    });
  }

  // Log trade
  batch.set(tradeRef, {
    id: tradeRef.id,
    agentId,
    marketId,
    bucketIndex,
    shares,
    cost,
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  const probs = bucketProbabilities(newBucketShares, market.liquidity);
  res.status(201).json({
    tradeId: tradeRef.id,
    marketId,
    bucketIndex,
    shares,
    cost,
    newProbabilities: probs,
    consensus: ammConsensus(newBucketShares, market.liquidity, market.rangeMin, market.rangeMax),
  });
}));

predictionsRouter.get('/positions', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const agentId = req.auth!.agentId;
  if (!agentId) { res.status(403).json({ error: 'Only agents can list positions' }); return; }

  let query: FirebaseFirestore.Query = db().collection('positions').where('agentId', '==', agentId);
  if (req.query.marketId) query = query.where('marketId', '==', req.query.marketId as string);

  const snapshot = await query.get();
  res.json(snapshot.docs.map(doc => doc.data()).filter((p: Record<string, unknown>) => (p.shares as number) !== 0));
}));

predictionsRouter.get('/markets', requireRole('agent', 'admin'), wrap(async (_req, res) => {
  res.json(await getMarkets());
}));

predictionsRouter.get('/markets/:id', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const doc = await db().collection('markets').doc(req.params.id as string).get();
  if (!doc.exists) { res.status(404).json({ error: 'Market not found' }); return; }
  const m = doc.data()!;
  const probs = bucketProbabilities(m.bucketShares, m.liquidity);
  const step = (m.rangeMax - m.rangeMin) / m.numBuckets;
  res.json({
    id: doc.id,
    metricId: m.metricId,
    metricName: m.metricName,
    targetDate: m.targetDate,
    resolved: m.resolved,
    rangeMin: m.rangeMin,
    rangeMax: m.rangeMax,
    numBuckets: m.numBuckets,
    liquidity: m.liquidity,
    consensus: ammConsensus(m.bucketShares, m.liquidity, m.rangeMin, m.rangeMax),
    buckets: probs.map((p, i) => ({
      index: i,
      rangeStart: m.rangeMin + i * step,
      rangeEnd: m.rangeMin + (i + 1) * step,
      probability: Math.round(p * 10000) / 10000,
    })),
  });
}));

// --- Admin-only ---

predictionsRouter.post('/markets', requireRole('admin'), wrap(async (req, res) => {
  const { metricId, targetDate, rangeMin, rangeMax, numBuckets, liquidity } = req.body;
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
  const nBuckets = typeof numBuckets === 'number' ? numBuckets : AMM_DEFAULTS.numBuckets;
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
    numBuckets: nBuckets,
    bucketShares: new Array(nBuckets).fill(0),
    liquidity: liq,
  });

  res.status(201).json({ id: ref.id, metricId, metricName: metric.name, targetDate });
}));

predictionsRouter.delete('/markets/:id', requireRole('admin'), wrap(async (req, res) => {
  const id = req.params.id as string;
  const ref = db().collection('markets').doc(id);
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

// One-time migration from old prediction model to AMM
predictionsRouter.post('/migrate', requireRole('admin'), wrap(async (_req, res) => {
  const marketsSnap = await db().collection('markets').get();
  const predsSnap = await db().collection('predictions').where('resolved', '==', false).get();

  let marketsUpdated = 0;
  let predictionsResolved = 0;
  let refunded = 0;
  const agentRefunds = new Map<string, number>();

  // Add AMM fields to markets missing them
  for (const doc of marketsSnap.docs) {
    const m = doc.data();
    if (m.bucketShares) continue;
    await doc.ref.update({
      rangeMin: AMM_DEFAULTS.rangeMin,
      rangeMax: AMM_DEFAULTS.rangeMax,
      numBuckets: AMM_DEFAULTS.numBuckets,
      bucketShares: new Array(AMM_DEFAULTS.numBuckets).fill(0),
      liquidity: AMM_DEFAULTS.liquidity,
    });
    marketsUpdated++;
  }

  // Resolve and refund all unresolved old predictions
  for (const doc of predsSnap.docs) {
    const pred = doc.data();
    await doc.ref.update({
      resolved: true,
      resolvedAt: FieldValue.serverTimestamp(),
      actualValue: null,
      payout: pred.stake,
    });
    agentRefunds.set(pred.agentId, (agentRefunds.get(pred.agentId) || 0) + pred.stake);
    predictionsResolved++;
    refunded += pred.stake;
  }

  // Credit refunds to agent balances
  for (const [agentId, amount] of agentRefunds) {
    await db().collection('agents').doc(agentId).update({
      balance: FieldValue.increment(amount),
      earnedBetting: FieldValue.increment(amount),
    });
  }

  res.json({ marketsUpdated, predictionsResolved, refunded });
}));
