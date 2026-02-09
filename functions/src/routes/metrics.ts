import { Router } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { wrap } from '../lib/wrap';
import { getAffectedMetrics } from '../lib/metrics-engine';
import * as svc from '../services/metrics';

function db() { return getFirestore(); }

export const metricsRouter = Router();

metricsRouter.get('/', wrap(async (_req, res) => {
  res.json(await svc.getAllMetrics());
}));

metricsRouter.get('/:id', wrap(async (req, res) => {
  const metric = await svc.getMetricById(req.params.id as string);
  if (!metric) { res.status(404).json({ error: 'Metric not found' }); return; }
  res.json(metric);
}));

metricsRouter.get('/:id/logs', wrap(async (req, res) => {
  res.json(await svc.getMetricLogs(req.params.id as string));
}));

metricsRouter.post('/', wrap(async (req, res) => {
  const { name, description = '', value = 0, formula = '0', decay = false } = req.body;
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }

  const docRef = await db().collection('metrics').add({ name, value, formula, description, decay, order: 999 });
  res.status(201).json({ ok: true, id: docRef.id });

  // Background: read metrics, recalculate, log
  const metrics = await svc.getAllMetrics();
  await svc.logSpecificMetrics(getAffectedMetrics([docRef.id], metrics), metrics);
}));

metricsRouter.put('/:id', wrap(async (req, res) => {
  const id = req.params.id as string;
  const { name, description, value, formula, decay, oldValue, updateNote = '' } = req.body;

  const writes: Promise<unknown>[] = [
    db().collection('metrics').doc(id).update({ name, description, value, formula, decay }),
  ];
  if (oldValue !== value) {
    writes.push(db().collection('updates').add({
      metricName: name, oldValue, newValue: value,
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

metricsRouter.delete('/:id', wrap(async (req, res) => {
  await svc.deleteMetric(req.params.id as string);
  res.status(204).send();
}));
