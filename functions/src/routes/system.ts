import { Router } from 'express';
import { wrap } from '../lib/wrap';
import { requireRole } from '../middleware/roles';
import { getAllMetrics, getStatus } from '../services/metrics';

export const systemRouter = Router();

systemRouter.get('/status', requireRole('agent', 'admin'), wrap(async (_req, res) => {
  res.json(getStatus(await getAllMetrics()));
}));
