import { Router } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { wrap } from '../lib/wrap';
import { requireRole } from '../middleware/roles';
import { getAffectedMetrics } from '../lib/metrics-engine';
import * as svc from '../services/metrics';

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
  const { name, description = '', value = 0, formula = '0', decay = false } = req.body;
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }

  const docRef = await db().collection('metrics').add({ name, value, formula, description, decay, order: 999 });
  res.status(201).json({ ok: true, id: docRef.id });

  // Background: read metrics, recalculate, log
  const metrics = await svc.getAllMetrics();
  await svc.logSpecificMetrics(getAffectedMetrics([docRef.id], metrics), metrics);
}));

metricsRouter.put('/:id', requireRole('admin'), wrap(async (req, res) => {
  const id = req.params.id as string;
  const { oldValue, updateNote = '', ...fields } = req.body;

  const allowed = ['name', 'description', 'value', 'formula', 'decay'] as const;
  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (fields[key] !== undefined) update[key] = fields[key];
  }
  if (Object.keys(update).length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }

  const docRef = db().collection('metrics').doc(id);
  const writes: Promise<unknown>[] = [docRef.update(update)];
  if (oldValue !== undefined && update.value !== undefined && oldValue !== update.value) {
    const metricName = (update.name as string) || (await docRef.get()).data()?.name || '';
    writes.push(db().collection('updates').add({
      metricName, oldValue, newValue: update.value,
      description: updateNote || 'Value updated',
      timestamp: FieldValue.serverTimestamp(),
    }));
  }
  await Promise.all(writes);
  res.json({ ok: true });

  // Background: read metrics, recalculate, log
  const metrics = await svc.getAllMetrics();
  await svc.logSpecificMetrics(getAffectedMetrics([id], metrics), metrics);
}));

metricsRouter.delete('/:id', requireRole('admin'), wrap(async (req, res) => {
  await svc.deleteMetric(req.params.id as string);
  res.status(204).send();
}));
