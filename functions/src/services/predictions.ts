import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../lib/db';
import { getAllMetrics } from './metrics';
import { voidMarket } from './markets';
import type { Metric } from '../types';
import { endOfPeriod } from '../lib/date-utils';
import { pHigher, consensus, resolutionPayouts } from '../lib/amm';
import { emitEvent } from './events';

async function resolveMarketDoc(
  marketDoc: FirebaseFirestore.DocumentSnapshot,
  metricMap: Map<string, Metric>,
): Promise<{ positions: number; totalPayout: number; skipped?: boolean }> {
  const m = marketDoc.data()!;
  const metric = metricMap.get(m.metricId);
  if (!metric) {
    console.error(`Market ${marketDoc.id} (${m.metricName}): metric ${m.metricId} not found, skipping resolution`);
    return { positions: 0, totalPayout: 0, skipped: true };
  }
  const rawValue = metric.total;

  if (rawValue < 0) {
    console.error(`Market ${marketDoc.id} (${m.metricName}): metric total is negative (${rawValue}), skipping resolution`);
    return { positions: 0, totalPayout: 0, skipped: true };
  }

  const actualValue = Math.min(rawValue, m.rangeMax);
  const [lowerPay, higherPay] = resolutionPayouts(actualValue, m.rangeMin, m.rangeMax);

  const batch = db().batch();
  batch.update(marketDoc.ref, { resolved: true, resolvedAt: FieldValue.serverTimestamp(), actualValue });

  const posSnap = await db().collection('positions')
    .where('marketId', '==', marketDoc.id)
    .get();

  let totalPayout = 0;
  let positions = 0;
  for (const posDoc of posSnap.docs) {
    const pos = posDoc.data();
    if (pos.shares <= 0) continue;
    const payFactor = pos.direction === 'higher' ? higherPay : lowerPay;
    const payout = Math.round(pos.shares * payFactor * 100) / 100;
    if (payout <= 0) continue;
    totalPayout += payout;
    positions++;
    batch.update(db().collection('agents').doc(pos.agentId), {
      balance: FieldValue.increment(payout),
      earnedBetting: FieldValue.increment(payout),
    });
  }

  await batch.commit();
  emitEvent('market:resolved', { marketId: marketDoc.id, metricName: m.metricName, targetDate: m.targetDate, actualValue }).catch(e => console.error('emitEvent failed:', e));
  return { positions, totalPayout };
}

export async function resolveMarket(marketId: string): Promise<{ resolved: boolean; totalPayout: number }> {
  const marketRef = db().collection('markets').doc(marketId);
  const marketDoc = await marketRef.get();
  if (!marketDoc.exists) return { resolved: false, totalPayout: 0 };
  if (marketDoc.data()!.resolved) return { resolved: false, totalPayout: 0 };

  const metrics = await getAllMetrics();
  const metricMap = new Map<string, Metric>(metrics.map(m => [m.id, m]));
  const result = await resolveMarketDoc(marketDoc, metricMap);
  if (result.skipped) return { resolved: false, totalPayout: 0 };
  return { resolved: true, totalPayout: result.totalPayout };
}

export async function resolvePredictions(targetDate?: string): Promise<{ resolved: number; totalPayout: number }> {
  const today = targetDate || new Date().toISOString().slice(0, 10);

  const marketSnap = await db().collection('markets')
    .where('resolved', '==', false)
    .get();

  const marketsToResolve: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const doc of marketSnap.docs) {
    const m = doc.data();
    if (endOfPeriod(m.targetDate) < today) marketsToResolve.push(doc);
  }

  if (marketsToResolve.length === 0) return { resolved: 0, totalPayout: 0 };

  const metrics = await getAllMetrics();
  const metricMap = new Map<string, Metric>(metrics.map(m => [m.id, m]));

  // Batch-fetch task statuses for any conditional markets
  const taskIds = [...new Set(marketsToResolve.map(d => d.data().taskId).filter(Boolean) as string[])];
  const taskStatusMap = new Map<string, string>();
  if (taskIds.length > 0) {
    const taskRefs = taskIds.map(id => db().collection('tasks').doc(id));
    const taskDocs = await db().getAll(...taskRefs);
    for (const doc of taskDocs) {
      if (doc.exists) taskStatusMap.set(doc.id, doc.data()!.status);
    }
  }

  let totalPayout = 0;
  let resolvedCount = 0;

  for (const marketDoc of marketsToResolve) {
    const taskId: string | undefined = marketDoc.data().taskId;
    if (taskId && taskStatusMap.get(taskId) !== 'approved') {
      await voidMarket(marketDoc);
    } else {
      const result = await resolveMarketDoc(marketDoc, metricMap);
      if (!result.skipped) {
        totalPayout += result.totalPayout;
        resolvedCount++;
      }
    }
  }

  return { resolved: resolvedCount, totalPayout };
}

export { voidMarket } from './markets';

export async function getMarkets(includeResolved = false, taskId?: string) {
  let query: FirebaseFirestore.Query = db().collection('markets');
  if (!includeResolved) query = query.where('resolved', '==', false);
  if (taskId) query = query.where('taskId', '==', taskId);
  const marketSnap = await query.orderBy('targetDate', 'asc').get();

  if (marketSnap.empty) return [];

  const docs = taskId
    ? marketSnap.docs
    : marketSnap.docs.filter(d => !d.data().taskId);

  if (docs.length === 0) return [];

  const tradeSnap = await db().collection('trades').get();
  const tradeCountByMarket = new Map<string, number>();
  for (const doc of tradeSnap.docs) {
    const t = doc.data();
    tradeCountByMarket.set(t.marketId, (tradeCountByMarket.get(t.marketId) || 0) + 1);
  }

  const posSnap = await db().collection('positions').get();
  const totalStakeByMarket = new Map<string, number>();
  for (const doc of posSnap.docs) {
    const p = doc.data();
    if (p.totalCost > 0) {
      totalStakeByMarket.set(p.marketId, (totalStakeByMarket.get(p.marketId) || 0) + p.totalCost);
    }
  }

  return docs.map(doc => {
    const m = doc.data();
    const shares: [number, number] = m.shares || [0, 0];
    return {
      id: doc.id,
      metricId: m.metricId,
      metricName: m.metricName,
      targetDate: m.targetDate,
      resolved: m.resolved,
      resolvedAt: m.resolvedAt,
      actualValue: m.actualValue,
      active: m.active !== false,
      createdAt: m.createdAt,
      consensus: consensus(shares, m.liquidity, m.rangeMin, m.rangeMax),
      probability: Math.round(pHigher(shares, m.liquidity) * 10000) / 10000,
      totalStake: totalStakeByMarket.get(doc.id) || 0,
      tradeCount: tradeCountByMarket.get(doc.id) || 0,
      rangeMin: m.rangeMin,
      rangeMax: m.rangeMax,
      liquidity: m.liquidity,
    };
  });
}
