import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { extractConsensusReferences, getTransitiveDependencyNames } from '../lib/metrics-engine';
import { toAbsoluteDate } from '../lib/date-utils';
import { AMM_DEFAULTS } from '../lib/amm';

function db() { return getFirestore(); }

type MetricRef = { metricId: string; metricName: string; targetDate: string };

function addRef(refs: Map<string, MetricRef>, metric: { id: string; name: string }, targetDate: string) {
  refs.set(`${metric.id}:${targetDate}`, { metricId: metric.id, metricName: metric.name, targetDate });
}

/**
 * Refresh markets for consensus references in formulas.
 * For each consensus() reference, also creates markets for all transitive
 * {MetricName} dependencies at the same target date.
 */
export async function refreshRelativeDateMarkets(): Promise<{ created: number }> {
  const metricsSnap = await db().collection('metrics').get();
  const nameToMetric = new Map<string, { id: string; name: string }>();
  const nameToFormula: Record<string, string> = {};
  const formulas: string[] = [];

  for (const doc of metricsSnap.docs) {
    const data = doc.data();
    nameToMetric.set(data.name, { id: doc.id, name: data.name });
    nameToFormula[data.name] = data.formula || '0';
    if (data.formula) formulas.push(data.formula);
  }

  const allRefs = new Map<string, MetricRef>();
  for (const formula of formulas) {
    for (const { name, date, isRelative } of extractConsensusReferences(formula)) {
      const targetDate = isRelative ? toAbsoluteDate(date) : date;
      const metric = nameToMetric.get(name);
      if (!metric) continue;

      addRef(allRefs, metric, targetDate);
      for (const depName of getTransitiveDependencyNames(name, nameToFormula)) {
        const dep = nameToMetric.get(depName);
        if (dep) addRef(allRefs, dep, targetDate);
      }
    }
  }

  if (allRefs.size === 0) return { created: 0 };

  const existingMarkets = new Set<string>();
  const marketSnap = await db().collection('markets').get();
  for (const doc of marketSnap.docs) {
    const data = doc.data();
    existingMarkets.add(`${data.metricId}:${data.targetDate}`);
  }

  const batch = db().batch();
  let created = 0;
  for (const [key, { metricId, metricName, targetDate }] of allRefs) {
    if (existingMarkets.has(key)) continue;

    const ref = db().collection('markets').doc();
    batch.set(ref, {
      id: ref.id,
      metricId,
      metricName,
      targetDate,
      resolved: false,
      resolvedAt: null,
      actualValue: null,
      createdAt: FieldValue.serverTimestamp(),
      rangeMin: AMM_DEFAULTS.rangeMin,
      rangeMax: AMM_DEFAULTS.rangeMax,
      shares: [0, 0],
      liquidity: AMM_DEFAULTS.liquidity,
    });
    created++;
  }

  if (created > 0) await batch.commit();
  return { created };
}
