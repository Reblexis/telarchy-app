import { Router } from 'express';
import { wrap } from '../lib/wrap';
import { requireRole } from '../middleware/roles';
import { getAllMetrics, getStatus } from '../services/metrics';
import { db } from '../lib/db';

export const systemRouter = Router();

async function getEconomy() {
  const doc = await db().collection('_system').doc('economy').get();
  if (!doc.exists) return { creditValueUsd: null };
  const { creditValueUsd = null } = doc.data()!;
  return { creditValueUsd };
}

systemRouter.get('/status', requireRole('agent', 'admin'), wrap(async (_req, res) => {
  const [metrics, economy] = await Promise.all([getAllMetrics(), getEconomy()]);
  res.json({ ...getStatus(metrics), ...economy });
}));
