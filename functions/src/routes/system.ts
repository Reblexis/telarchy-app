import { Router } from 'express';
import { wrap } from '../lib/wrap';
import { requireRole } from '../middleware/roles';
import { getAllMetrics, getStatus } from '../services/metrics';
import { applyDecay } from '../services/decay';

export const systemRouter = Router();

systemRouter.get('/status', requireRole('agent', 'admin'), wrap(async (_req, res) => {
  res.json(getStatus(await getAllMetrics()));
}));

systemRouter.post('/decay', requireRole('admin'), wrap(async (_req, res) => {
  const result = await applyDecay();
  res.json(result || { message: 'No decay needed' });
}));
