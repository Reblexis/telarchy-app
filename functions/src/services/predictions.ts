import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAllMetrics } from './metrics';
import type { Metric } from '../types';
import { endOfPeriod } from '../lib/date-utils';
import { pHigher, consensus, resolutionPayouts } from '../lib/amm';
import { emitEvent } from './events';

function db() { return getFirestore(); }

export async function resolvePredictions(targetDate?: string): Promise<{ resolved: number; totalPayout: number }> {
  const today = targetDate || new Date().toISOString().slice(0, 10);

  const marketSnap = await db().collection('markets')
    .where('resolved', '==', false)
    .get();

  const marketsToResolve: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const doc of marketSnap.docs) {
    const m = doc.data();
    if (endOfPeriod(m.targetDate) <= today) marketsToResolve.push(doc);
  }

  if (marketsToResolve.length === 0) return { resolved: 0, totalPayout: 0 };

  const metrics = await getAllMetrics();
  const metricMap = new Map<string, Metric>(metrics.map(m => [m.id, m]));

  let totalPayout = 0;
  let resolvedCount = 0;

  for (const marketDoc of marketsToResolve) {
    const m = marketDoc.data();
    const metric = metricMap.get(m.metricId);
    const actualValue = metric ? metric.total : 0;
    const [lowerPay, higherPay] = resolutionPayouts(actualValue, m.rangeMin, m.rangeMax);

    const batch = db().batch();

    batch.update(marketDoc.ref, {
      resolved: true,
      resolvedAt: FieldValue.serverTimestamp(),
      actualValue,
    });

    // Pay out all positions proportionally
    const posSnap = await db().collection('positions')
      .where('marketId', '==', marketDoc.id)
      .get();

    for (const posDoc of posSnap.docs) {
      const pos = posDoc.data();
      if (pos.shares <= 0) continue;
      const payFactor = pos.direction === 'higher' ? higherPay : lowerPay;
      const payout = Math.round(pos.shares * payFactor * 100) / 100;
      if (payout <= 0) continue;

      totalPayout += payout;
      resolvedCount++;

      batch.update(db().collection('agents').doc(pos.agentId), {
        balance: FieldValue.increment(payout),
        earnedBetting: FieldValue.increment(payout),
      });
    }

    await batch.commit();
    emitEvent('market:resolved', { marketId: marketDoc.id, metricName: m.metricName, targetDate: m.targetDate, actualValue }).catch(() => {});
  }

  return { resolved: resolvedCount, totalPayout };
}

export async function getMarkets(includeResolved = false) {
  let query: FirebaseFirestore.Query = db().collection('markets');
  if (!includeResolved) query = query.where('resolved', '==', false);
  const marketSnap = await query.orderBy('targetDate', 'asc').get();

  if (marketSnap.empty) return [];

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

  return marketSnap.docs.map(doc => {
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
