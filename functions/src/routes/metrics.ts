import { Router } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { wrap } from '../lib/wrap';
import { requireRole } from '../middleware/roles';
import {
  getAffectedMetrics, extractMetricReferences, getTransitiveDependencyNames,
  detectCircularDependency,
} from '../lib/metrics-engine';
import { sampleTimePoints, getLeafDescendantNames } from '../lib/time-preference';
import * as svc from '../services/metrics';
import { emitEvent } from '../services/events';
import type { TimePreference } from '../types';

function db() { return getFirestore(); }

export const metricsRouter = Router();

// Read routes: agent + admin
metricsRouter.get('/', requireRole('agent', 'admin'), wrap(async (_req, res) => {
  res.json(await svc.getAllMetrics());
}));

metricsRouter.get('/:id', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const metric = await svc.getMetricById(req.params.id as string);
  if (!metric) { res.status(404).json({ error: 'Metric not found' }); return; }
  res.json(metric);
}));

metricsRouter.get('/:id/logs', requireRole('agent', 'admin'), wrap(async (req, res) => {
  res.json(await svc.getMetricLogs(req.params.id as string));
}));

// Write routes: admin only
metricsRouter.post('/', requireRole('admin'), wrap(async (req, res) => {
  const { name, description = '', value = 0, formula = '0', timePreference } = req.body;
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }

  const tp = parseTimePreference(timePreference);
  if (tp instanceof Error) { res.status(400).json({ error: tp.message }); return; }

  // Validate TP only makes sense on non-leaf metrics
  if (tp?.enabled && (!formula || formula.trim() === '0')) {
    res.status(400).json({ error: 'Time preference can only be enabled on non-leaf metrics (with a formula)' });
    return;
  }

  const isDefinition = formula && formula.trim() !== '0';
  const firestoreData: Record<string, unknown> = {
    name, value: isDefinition ? 0 : (value || 0), formula, description, order: 999,
  };
  if (tp?.enabled) firestoreData.timePreference = tp;

  const docRef = await db().collection('metrics').add(firestoreData);
  res.status(201).json({ ok: true, id: docRef.id });

  // Background: spawn TP markets if needed, then log
  if (tp?.enabled) {
    await svc.ensureMarketsForTimePreference(docRef.id, tp.halfLife);
  }
  const metrics = await svc.getAllMetrics();
  await svc.logSpecificMetrics(getAffectedMetrics([docRef.id], metrics), metrics);
}));

metricsRouter.put('/:id', requireRole('admin'), wrap(async (req, res) => {
  const id = req.params.id as string;
  const { oldValue, updateNote = '', timePreference: rawTP, ...fields } = req.body;

  // Validate and parse timePreference
  const newTP = parseTimePreference(rawTP);
  if (newTP instanceof Error) { res.status(400).json({ error: newTP.message }); return; }

  const allowed = ['name', 'description', 'value', 'formula'] as const;
  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (fields[key] !== undefined) update[key] = fields[key];
  }
  if (Object.keys(update).length === 0 && rawTP === undefined) {
    res.status(400).json({ error: 'No fields to update' }); return;
  }

  // Read old doc
  const docRef = db().collection('metrics').doc(id);
  const oldDoc = await docRef.get();
  if (!oldDoc.exists) { res.status(404).json({ error: 'Metric not found' }); return; }
  const oldData = oldDoc.data()!;
  const oldTP: TimePreference | undefined = oldData.timePreference?.enabled ? oldData.timePreference : undefined;

  const effectiveFormula = (update.formula as string | undefined) ?? oldData.formula ?? '0';
  const effectiveName = (update.name as string | undefined) ?? oldData.name;

  // Validate TP on non-leaf
  if (newTP?.enabled && (!effectiveFormula || effectiveFormula.trim() === '0')) {
    res.status(400).json({ error: 'Time preference can only be enabled on non-leaf metrics (with a formula)' });
    return;
  }

  // Circular dependency check
  if (update.formula) {
    const allMetrics = await svc.getAllMetrics();
    if (detectCircularDependency(id, update.formula as string, allMetrics)) {
      res.status(400).json({ error: 'This formula would create a circular dependency' }); return;
    }
  }

  // One-per-path constraint if enabling TP
  const wasTPEnabled = oldTP?.enabled ?? false;
  const isTPEnabled = newTP !== undefined ? (newTP?.enabled ?? false) : wasTPEnabled;
  if (isTPEnabled && !wasTPEnabled) {
    const conflict = await findTPConflict(id, effectiveName);
    if (conflict) {
      res.status(400).json({ error: `Time preference conflict: ${conflict} already has time preference on this path` });
      return;
    }
  }

  // Definition metrics must have value = 0
  if (effectiveFormula && effectiveFormula.trim() !== '0') {
    update.value = 0;
  }

  // Build Firestore update
  if (rawTP !== undefined) {
    update.timePreference = newTP?.enabled ? newTP : FieldValue.delete();
  }

  const writes: Promise<unknown>[] = [docRef.update(update)];
  const isLeafMetric = !effectiveFormula || effectiveFormula.trim() === '0';
  if (isLeafMetric && oldValue !== undefined && update.value !== undefined && oldValue !== update.value) {
    writes.push(db().collection('updates').add({
      metricName: effectiveName, oldValue, newValue: update.value,
      description: updateNote || 'Value updated',
      timestamp: FieldValue.serverTimestamp(),
    }));
  }
  await Promise.all(writes);
  res.json({ ok: true });

  // Background: market management and logging
  const effectiveHalfLife = newTP?.halfLife ?? oldTP?.halfLife ?? 1;

  // TP state changes
  if (newTP !== undefined) {
    if (newTP?.enabled && !wasTPEnabled) {
      // Newly enabled: spawn markets
      await svc.ensureMarketsForTimePreference(id, newTP.halfLife);
    } else if (!newTP?.enabled && wasTPEnabled) {
      // Disabled: void leaf markets (respawn with dummy halfLife = 0 won't spawn; just void)
      await voidLeafMarketsForTPMetric(id, oldTP!.halfLife);
    } else if (newTP?.enabled && wasTPEnabled && newTP.halfLife !== oldTP!.halfLife) {
      // HalfLife changed: respawn
      await svc.respawnMarketsForTimePreference(id, newTP.halfLife);
    }
  }

  // Definition change on a non-TP metric: find TP ancestors and respawn
  const definitionChanged = isDefinitionChange(oldData, update, effectiveFormula);
  if (definitionChanged && !isTPEnabled) {
    const tpAncestorIds = await findTPAncestors(id);
    for (const tpId of tpAncestorIds) {
      const tpDoc = await db().collection('metrics').doc(tpId).get();
      const tpHalfLife = tpDoc.data()?.timePreference?.halfLife;
      if (tpHalfLife) await svc.respawnMarketsForTimePreference(tpId, tpHalfLife);
    }
  }

  // Definition change on TP metric itself: respawn its markets
  if (definitionChanged && isTPEnabled) {
    await svc.respawnMarketsForTimePreference(id, effectiveHalfLife);
  }

  const metrics = await svc.getAllMetrics();
  await svc.logSpecificMetrics(getAffectedMetrics([id], metrics), metrics);
  if (update.value !== undefined) {
    const metric = metrics.find(m => m.id === id);
    emitEvent('metric:updated', { metricId: id, metricName: metric?.name ?? '', oldValue: oldValue ?? null, newValue: update.value }).catch(() => {});
  }
}));

metricsRouter.delete('/:id', requireRole('admin'), wrap(async (req, res) => {
  await svc.deleteMetric(req.params.id as string);
  res.status(204).send();
}));

/** One-time migration: zero the base value on all existing definition metrics. */
metricsRouter.post('/migrate-leaf-types', requireRole('admin'), wrap(async (_req, res) => {
  const snap = await db().collection('metrics').get();
  const batch = db().batch();
  let updated = 0;
  for (const doc of snap.docs) {
    const formula = doc.data().formula || '0';
    if (formula.trim() !== '0' && doc.data().value !== 0) {
      batch.update(doc.ref, { value: 0 });
      updated++;
    }
  }
  if (updated > 0) await batch.commit();
  res.json({ updated });
}));

// --- Helpers ---

function parseTimePreference(raw: unknown): TimePreference | undefined | Error {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') return new Error('timePreference must be an object');
  const obj = raw as Record<string, unknown>;
  if (typeof obj.enabled !== 'boolean') return new Error('timePreference.enabled must be a boolean');
  if (obj.enabled) {
    if (typeof obj.halfLife !== 'number' || obj.halfLife <= 0) {
      return new Error('timePreference.halfLife must be a positive number (years)');
    }
  }
  return { enabled: obj.enabled, halfLife: (obj.halfLife as number) ?? 1 };
}

/**
 * Returns true if the update constitutes a definition change.
 * Leaf value changes (formula === '0') are NOT definition changes.
 */
function isDefinitionChange(
  oldData: FirebaseFirestore.DocumentData,
  update: Record<string, unknown>,
  effectiveFormula: string,
): boolean {
  if (update.name !== undefined && update.name !== oldData.name) return true;
  if (update.description !== undefined && update.description !== oldData.description) return true;
  if (update.formula !== undefined && update.formula !== (oldData.formula ?? '0')) return true;
  // Value change is a definition change only for non-leaf nodes
  const isLeaf = !effectiveFormula || effectiveFormula.trim() === '0';
  if (!isLeaf && update.value !== undefined && update.value !== oldData.value) return true;
  return false;
}

/**
 * Find TP metrics that are ancestors (direct or transitive referrers) of the given metric.
 */
async function findTPAncestors(metricId: string): Promise<string[]> {
  const metricsSnap = await db().collection('metrics').get();
  const referencedBy: Record<string, string[]> = {};

  for (const doc of metricsSnap.docs) {
    referencedBy[doc.id] = [];
  }
  for (const doc of metricsSnap.docs) {
    const formula = doc.data().formula || '0';
    for (const refName of extractMetricReferences(formula)) {
      // Find the doc with this name
      const refDoc = metricsSnap.docs.find(d => d.data().name === refName);
      if (refDoc) {
        referencedBy[refDoc.id].push(doc.id);
      }
    }
  }

  const tpAncestors: string[] = [];
  const visited = new Set<string>();
  const queue = [...(referencedBy[metricId] || [])];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const doc = metricsSnap.docs.find(d => d.id === currentId);
    if (doc?.data()?.timePreference?.enabled) {
      tpAncestors.push(currentId);
    } else {
      queue.push(...(referencedBy[currentId] || []));
    }
  }

  return tpAncestors;
}

/**
 * Check if any ancestor or descendant of the given metric has TP enabled.
 * Returns the name of the conflicting metric, or null if no conflict.
 */
async function findTPConflict(metricId: string, metricName: string): Promise<string | null> {
  const metricsSnap = await db().collection('metrics').get();
  const nameToId: Record<string, string> = {};
  const referencedBy: Record<string, string[]> = {};
  const nameToFormula: Record<string, string> = {};

  for (const doc of metricsSnap.docs) {
    nameToId[doc.data().name] = doc.id;
    referencedBy[doc.id] = [];
    nameToFormula[doc.data().name] = doc.data().formula || '0';
  }
  for (const doc of metricsSnap.docs) {
    for (const refName of extractMetricReferences(doc.data().formula || '0')) {
      const refId = nameToId[refName];
      if (refId) referencedBy[refId].push(doc.id);
    }
  }

  // Check ancestors
  const visitedAncestors = new Set<string>();
  const ancestorQueue = [...(referencedBy[metricId] || [])];
  while (ancestorQueue.length > 0) {
    const id = ancestorQueue.shift()!;
    if (visitedAncestors.has(id)) continue;
    visitedAncestors.add(id);
    const doc = metricsSnap.docs.find(d => d.id === id);
    if (doc?.data()?.timePreference?.enabled) return doc.data().name;
    ancestorQueue.push(...(referencedBy[id] || []));
  }

  // Check descendants
  const descNames = getTransitiveDependencyNames(metricName, nameToFormula);
  for (const name of descNames) {
    const id = nameToId[name];
    const doc = metricsSnap.docs.find(d => d.id === id);
    if (doc?.data()?.timePreference?.enabled) return name;
  }

  return null;
}

/**
 * Void all open markets for leaf descendants of a TP node (used when disabling TP).
 */
async function voidLeafMarketsForTPMetric(tpMetricId: string, oldHalfLife: number): Promise<void> {
  const metricsSnap = await db().collection('metrics').get();
  const nameToFormula: Record<string, string> = {};
  const nameToId = new Map<string, string>();
  let tpMetricName = '';

  for (const doc of metricsSnap.docs) {
    nameToFormula[doc.data().name] = doc.data().formula || '0';
    nameToId.set(doc.data().name, doc.id);
    if (doc.id === tpMetricId) tpMetricName = doc.data().name;
  }

  if (!tpMetricName) return;

  // Use the old formula (before update) — formula may still be in Firestore since we're post-update
  const leafNames = getLeafDescendantNames(tpMetricName, nameToFormula);
  if (leafNames.length === 0) return;

  const leafIds = new Set(leafNames.map((n: string) => nameToId.get(n)).filter(Boolean) as string[]);

  // Get the specific dates that were spawned under old halfLife to limit scope
  const oldDates = new Set(sampleTimePoints(oldHalfLife).map(p => p.date));

  const openMarkets = await db().collection('markets').where('resolved', '==', false).get();
  for (const doc of openMarkets.docs) {
    const m = doc.data();
    if (!leafIds.has(m.metricId) || !oldDates.has(m.targetDate)) continue;

    const posSnap = await db().collection('positions').where('marketId', '==', doc.id).get();
    const batch = db().batch();
    batch.update(doc.ref, { resolved: true, resolvedAt: FieldValue.serverTimestamp(), actualValue: null, voided: true });

    for (const posDoc of posSnap.docs) {
      const pos = posDoc.data();
      if (pos.totalCost <= 0) continue;
      batch.update(db().collection('agents').doc(pos.agentId), {
        balance: FieldValue.increment(pos.totalCost),
        earnedBetting: FieldValue.increment(pos.totalCost),
        spentBetting: FieldValue.increment(-pos.totalCost),
      });
    }
    await batch.commit();
  }
}
