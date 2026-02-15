import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAllMetrics } from './metrics';
import type { Metric } from '../types';
import { endOfPeriod } from '../lib/date-utils';

function db() { return getFirestore(); }

export function calculatePayout(predictedValue: number, actualValue: number, stake: number): number {
  const error = Math.abs(predictedValue - actualValue);
  const maxError = Math.max(Math.abs(actualValue), 1);
  const score = Math.max(0, 1 - error / maxError);
  return Math.round(stake * 2 * score * 100) / 100; // round to 2 decimals
}

export async function resolvePredictions(targetDate?: string): Promise<{ resolved: number; totalPayout: number }> {
  const today = targetDate || new Date().toISOString().slice(0, 10);

  // Fetch all unresolved markets (can't filter by targetDate in query due to mixed formats)
  const marketSnap = await db().collection('markets')
    .where('resolved', '==', false)
    .get();

  // Filter to markets whose period has ended
  const marketsToResolve: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const doc of marketSnap.docs) {
    const m = doc.data();
    const periodEnd = endOfPeriod(m.targetDate);
    if (periodEnd <= today) {
      marketsToResolve.push(doc);
    }
  }

  if (marketsToResolve.length === 0) return { resolved: 0, totalPayout: 0 };

  // Fetch current metric totals
  const metrics = await getAllMetrics();
  const metricMap = new Map<string, Metric>(metrics.map(m => [m.id, m]));

  const marketKeys = new Set<string>();
  const marketActuals = new Map<string, number>();
  const batch = db().batch();

  for (const doc of marketsToResolve) {
    const m = doc.data();
    const key = `${m.metricId}:${m.targetDate}`;
    const metric = metricMap.get(m.metricId);
    const actualValue = metric ? metric.total : 0;
    marketKeys.add(key);
    marketActuals.set(key, actualValue);

    batch.update(doc.ref, {
      resolved: true,
      resolvedAt: FieldValue.serverTimestamp(),
      actualValue,
    });
  }

  // Fetch all unresolved predictions and filter to those in markets we're resolving
  const predSnap = await db().collection('predictions').where('resolved', '==', false).get();

  let totalPayout = 0;
  let resolvedCount = 0;
  const agentPayouts = new Map<string, number>();

  for (const doc of predSnap.docs) {
    const pred = doc.data();
    const key = `${pred.metricId}:${pred.targetDate}`;
    if (!marketKeys.has(key)) continue;

    const actualValue = marketActuals.get(key) || 0;
    const payout = calculatePayout(pred.predictedValue, actualValue, pred.stake);

    batch.update(doc.ref, {
      resolved: true,
      resolvedAt: FieldValue.serverTimestamp(),
      actualValue,
      payout,
    });

    totalPayout += payout;
    resolvedCount++;
    agentPayouts.set(pred.agentId, (agentPayouts.get(pred.agentId) || 0) + payout);
  }

  // Credit payouts to agent balances
  for (const [agentId, payout] of agentPayouts) {
    if (payout > 0) {
      batch.update(db().collection('agents').doc(agentId), {
        balance: FieldValue.increment(payout),
        earnedBetting: FieldValue.increment(payout),
      });
    }
  }

  await batch.commit();
  return { resolved: resolvedCount, totalPayout };
}

export async function getConsensus(metricId: string, targetDate: string): Promise<{ consensus: number | null; totalStake: number; count: number }> {
  const snapshot = await db().collection('predictions')
    .where('metricId', '==', metricId)
    .where('targetDate', '==', targetDate)
    .where('resolved', '==', false)
    .get();

  if (snapshot.empty) return { consensus: null, totalStake: 0, count: 0 };

  let weightedSum = 0;
  let totalStake = 0;
  for (const doc of snapshot.docs) {
    const { predictedValue, stake } = doc.data();
    weightedSum += predictedValue * stake;
    totalStake += stake;
  }

  return {
    consensus: totalStake > 0 ? Math.round((weightedSum / totalStake) * 100) / 100 : null,
    totalStake,
    count: snapshot.size,
  };
}

export async function getMarkets(includeResolved = false) {
  let query: FirebaseFirestore.Query = db().collection('markets');
  if (!includeResolved) query = query.where('resolved', '==', false);
  const marketSnap = await query.orderBy('targetDate', 'asc').get();

  if (marketSnap.empty) return [];

  // Fetch unresolved predictions to compute consensus per market
  const predSnap = await db().collection('predictions').where('resolved', '==', false).get();
  const predsByKey = new Map<string, { weightedSum: number; totalStake: number; count: number }>();
  for (const doc of predSnap.docs) {
    const { metricId, targetDate, predictedValue, stake } = doc.data();
    const key = `${metricId}:${targetDate}`;
    const existing = predsByKey.get(key);
    if (existing) {
      existing.weightedSum += predictedValue * stake;
      existing.totalStake += stake;
      existing.count++;
    } else {
      predsByKey.set(key, { weightedSum: predictedValue * stake, totalStake: stake, count: 1 });
    }
  }

  return marketSnap.docs.map(doc => {
    const m = doc.data();
    const preds = predsByKey.get(`${m.metricId}:${m.targetDate}`);
    return {
      id: doc.id,
      metricId: m.metricId,
      metricName: m.metricName,
      targetDate: m.targetDate,
      resolved: m.resolved,
      resolvedAt: m.resolvedAt,
      actualValue: m.actualValue,
      createdAt: m.createdAt,
      consensus: preds && preds.totalStake > 0 ? Math.round((preds.weightedSum / preds.totalStake) * 100) / 100 : null,
      totalStake: preds ? preds.totalStake : 0,
      predictionCount: preds ? preds.count : 0,
    };
  });
}
