import { Router } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { wrap } from '../lib/wrap';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { getAllMetrics } from '../services/metrics';
import { resolvePredictions, getConsensus, getMarkets } from '../services/predictions';
import { refreshRelativeDateMarkets } from '../services/markets';
import { isValidDateFormat, endOfPeriod } from '../lib/date-utils';

function db() { return getFirestore(); }

export const predictionsRouter = Router();

// All prediction routes require auth
predictionsRouter.use(authMiddleware);

// --- Agent-accessible (role: agent or admin) ---

predictionsRouter.post('/', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const agentId = req.auth!.agentId;
  if (!agentId) { res.status(403).json({ error: 'Only agents can place predictions' }); return; }

  const { metricId, targetDate, predictedValue, stake } = req.body;
  if (!metricId || typeof metricId !== 'string') { res.status(400).json({ error: 'metricId is required' }); return; }
  if (!targetDate || typeof targetDate !== 'string' || !isValidDateFormat(targetDate)) { res.status(400).json({ error: 'targetDate must be YYYY, YYYY-MM, YYYY-Www, or YYYY-MM-DD' }); return; }
  if (typeof predictedValue !== 'number') { res.status(400).json({ error: 'predictedValue must be a number' }); return; }
  if (typeof stake !== 'number' || stake <= 0) { res.status(400).json({ error: 'stake must be a positive number' }); return; }

  // Validate market exists and is open
  const marketSnap = await db().collection('markets')
    .where('metricId', '==', metricId)
    .where('targetDate', '==', targetDate)
    .where('resolved', '==', false)
    .limit(1)
    .get();
  if (marketSnap.empty) { res.status(404).json({ error: 'No open market for this metric and date' }); return; }
  const metricName = marketSnap.docs[0].data().metricName;

  // Check agent balance
  const agentRef = db().collection('agents').doc(agentId);
  const agentDoc = await agentRef.get();
  if (!agentDoc.exists) { res.status(404).json({ error: 'Agent not found' }); return; }
  const balance = agentDoc.data()!.balance as number;
  if (balance < stake) { res.status(400).json({ error: 'Insufficient balance', balance }); return; }

  // Deduct stake and create prediction
  const predRef = db().collection('predictions').doc();
  const batch = db().batch();
  batch.update(agentRef, {
    balance: FieldValue.increment(-stake),
    spentBetting: FieldValue.increment(stake),
  });
  batch.set(predRef, {
    id: predRef.id,
    agentId,
    metricId,
    metricName,
    targetDate,
    predictedValue,
    stake,
    createdAt: FieldValue.serverTimestamp(),
    resolved: false,
    resolvedAt: null,
    actualValue: null,
    payout: null,
  });
  await batch.commit();

  res.status(201).json({ id: predRef.id, agentId, metricId, metricName, targetDate, predictedValue, stake });
}));

predictionsRouter.get('/mine', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const agentId = req.auth!.agentId;
  if (!agentId) { res.status(403).json({ error: 'Only agents can list own predictions' }); return; }

  let query: FirebaseFirestore.Query = db().collection('predictions').where('agentId', '==', agentId);
  if (req.query.metricId) query = query.where('metricId', '==', req.query.metricId);
  if (req.query.resolved !== undefined) query = query.where('resolved', '==', req.query.resolved === 'true');

  const snapshot = await query.orderBy('createdAt', 'desc').get();
  res.json(snapshot.docs.map(doc => doc.data()));
}));

predictionsRouter.get('/consensus', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { metricId, targetDate } = req.query;
  if (!metricId || !targetDate) { res.status(400).json({ error: 'metricId and targetDate are required' }); return; }
  res.json(await getConsensus(metricId as string, targetDate as string));
}));

predictionsRouter.get('/markets', requireRole('agent', 'admin'), wrap(async (_req, res) => {
  res.json(await getMarkets());
}));

// --- Admin-only ---

predictionsRouter.post('/markets', requireRole('admin'), wrap(async (req, res) => {
  const { metricId, targetDate } = req.body;
  if (!metricId || typeof metricId !== 'string') { res.status(400).json({ error: 'metricId is required' }); return; }
  if (!targetDate || typeof targetDate !== 'string' || !isValidDateFormat(targetDate)) { res.status(400).json({ error: 'targetDate must be YYYY, YYYY-MM, YYYY-Www, or YYYY-MM-DD' }); return; }

  const today = new Date().toISOString().slice(0, 10);
  if (endOfPeriod(targetDate) <= today) { res.status(400).json({ error: 'targetDate period must be in the future' }); return; }

  // Validate metric exists
  const metrics = await getAllMetrics();
  const metric = metrics.find(m => m.id === metricId);
  if (!metric) { res.status(404).json({ error: 'Metric not found' }); return; }

  // Check for duplicate
  const existing = await db().collection('markets')
    .where('metricId', '==', metricId)
    .where('targetDate', '==', targetDate)
    .limit(1)
    .get();
  if (!existing.empty) { res.status(409).json({ error: 'Market already exists' }); return; }

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

predictionsRouter.get('/', requireRole('admin'), wrap(async (req, res) => {
  let query: FirebaseFirestore.Query = db().collection('predictions');
  if (req.query.agentId) query = query.where('agentId', '==', req.query.agentId);
  if (req.query.metricId) query = query.where('metricId', '==', req.query.metricId);
  if (req.query.targetDate) query = query.where('targetDate', '==', req.query.targetDate);
  if (req.query.resolved !== undefined) query = query.where('resolved', '==', req.query.resolved === 'true');

  const snapshot = await query.orderBy('createdAt', 'desc').get();
  res.json(snapshot.docs.map(doc => doc.data()));
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
