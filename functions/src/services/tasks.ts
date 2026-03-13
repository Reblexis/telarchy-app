import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { pHigher, consensus } from '../lib/amm';
import { voidMarket } from './predictions';

function db() { return getFirestore(); }

/**
 * Create conditional markets for a task by cloning all currently open, active
 * leaf markets (TP-driven). Each clone has the same metric/date/range but starts
 * with zero bets and is tagged with taskId. Idempotent.
 */
export async function createConditionalMarkets(taskId: string): Promise<string[]> {
  // Identify leaf metric IDs (no formula or formula === '0')
  const metricsSnap = await db().collection('metrics').get();
  const leafMetricIds = new Set(
    metricsSnap.docs
      .filter(d => { const f = d.data().formula; return !f || f === '0'; })
      .map(d => d.id),
  );

  // All open, active markets for leaf metrics
  const openSnap = await db().collection('markets')
    .where('resolved', '==', false)
    .where('active', '==', true)
    .get();
  const sourceMarkets = openSnap.docs.filter(d => leafMetricIds.has(d.data().metricId) && !d.data().taskId);

  // Already-created conditional markets for this task (for idempotency)
  const existingSnap = await db().collection('markets')
    .where('taskId', '==', taskId)
    .where('resolved', '==', false)
    .get();
  const existingKeys = new Set(existingSnap.docs.map(d => `${d.data().metricId}:${d.data().targetDate}`));
  const existingIds = existingSnap.docs.map(d => d.id);

  const batch = db().batch();
  const newIds: string[] = [];

  for (const src of sourceMarkets) {
    const m = src.data();
    if (existingKeys.has(`${m.metricId}:${m.targetDate}`)) continue;
    const ref = db().collection('markets').doc();
    batch.set(ref, {
      id: ref.id,
      metricId: m.metricId,
      metricName: m.metricName,
      targetDate: m.targetDate,
      resolved: false,
      resolvedAt: null,
      actualValue: null,
      active: true,
      taskId,
      createdAt: FieldValue.serverTimestamp(),
      rangeMin: m.rangeMin,
      rangeMax: m.rangeMax,
      shares: [0, 0],
      liquidity: m.liquidity,
    });
    newIds.push(ref.id);
  }

  if (newIds.length > 0) await batch.commit();
  return [...existingIds, ...newIds];
}

/** Void all open conditional markets tied to a task. */
export async function voidTaskMarkets(taskId: string): Promise<void> {
  const marketsSnap = await db().collection('markets')
    .where('taskId', '==', taskId)
    .where('resolved', '==', false)
    .get();
  for (const doc of marketsSnap.docs) {
    await voidMarket(doc.id);
  }
}

/** Gift price credits to the proposing agent and mark the task approved. */
export async function approveTask(taskId: string): Promise<void> {
  const taskRef = db().collection('tasks').doc(taskId);
  const taskDoc = await taskRef.get();
  if (!taskDoc.exists) throw new Error('Task not found');
  const task = taskDoc.data()!;
  if (task.status !== 'pending') throw new Error('Task is not pending');

  const agentRef = db().collection('agents').doc(task.proposedBy);
  const agentDoc = await agentRef.get();
  if (!agentDoc.exists) throw new Error('Proposing agent not found');

  const batch = db().batch();
  batch.update(taskRef, { status: 'approved' });
  batch.update(agentRef, {
    balance: FieldValue.increment(task.price),
    earnedTasks: FieldValue.increment(task.price),
  });
  await batch.commit();
}

/** Return enriched market summaries for the given market IDs. */
export async function getTaskMarketSummaries(marketIds: string[]) {
  if (marketIds.length === 0) return [];
  const docs = await Promise.all(marketIds.map(id => db().collection('markets').doc(id).get()));
  const tradeCountMap = new Map<string, number>();
  if (marketIds.length > 0) {
    const tradesSnap = await db().collection('trades')
      .where('marketId', 'in', marketIds.slice(0, 10)) // Firestore 'in' limit = 10
      .get();
    for (const d of tradesSnap.docs) tradeCountMap.set(d.data().marketId, (tradeCountMap.get(d.data().marketId) || 0) + 1);
  }
  return docs
    .filter(d => d.exists)
    .map(d => {
      const m = d.data()!;
      const shares: [number, number] = m.shares || [0, 0];
      return {
        marketId: d.id,
        metricId: m.metricId,
        metricName: m.metricName,
        consensus: consensus(shares, m.liquidity, m.rangeMin, m.rangeMax),
        probability: Math.round(pHigher(shares, m.liquidity) * 10000) / 10000,
        rangeMin: m.rangeMin,
        rangeMax: m.rangeMax,
        tradeCount: tradeCountMap.get(d.id) || 0,
        resolved: m.resolved,
        actualValue: m.actualValue ?? null,
      };
    });
}
