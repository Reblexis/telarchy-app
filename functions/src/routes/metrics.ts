import { Router } from 'express';
import { wrap } from '../lib/wrap';
import * as svc from '../services/metrics';

export const metricsRouter = Router();

metricsRouter.get('/', wrap(async (_req, res) => {
  res.json(await svc.getAllMetrics());
}));

metricsRouter.get('/:id', wrap(async (req, res) => {
  const id = req.params.id as string;
  const metric = await svc.getMetricById(id);
  if (!metric) { res.status(404).json({ error: 'Metric not found' }); return; }
  res.json(metric);
}));

metricsRouter.get('/:id/logs', wrap(async (req, res) => {
  res.json(await svc.getMetricLogs(req.params.id as string));
}));

metricsRouter.post('/', wrap(async (req, res) => {
  const { name, description = '', value = 0, formula = '0', decay = false } = req.body;
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }
  res.status(201).json(await svc.createMetric(name, description, value, formula, decay));
}));

metricsRouter.put('/:id', wrap(async (req, res) => {
  const { name, description, value, formula, decay, oldValue, updateNote = '' } = req.body;
  res.json(await svc.updateMetric(req.params.id as string, name, description, value, formula, decay, oldValue, updateNote));
}));

metricsRouter.delete('/:id', wrap(async (req, res) => {
  await svc.deleteMetric(req.params.id as string);
  res.status(204).send();
}));
