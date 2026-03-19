import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
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

// Wipe all agent balances/stats, market AMM state, positions, trades, deposits, and withdrawals.
// Markets themselves are kept (with zeroed liquidity) so admin doesn't need to recreate them.
systemRouter.post('/reset-economy', requireRole('admin'), wrap(async (_req, res) => {
  const firestore = db();

  async function deleteCollection(name: string) {
    let snapshot = await firestore.collection(name).limit(400).get();
    while (!snapshot.empty) {
      const batch = firestore.batch();
      snapshot.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      snapshot = await firestore.collection(name).limit(400).get();
    }
  }

  // Reset agent balances — skip the 'user' pseudo-agent (admin with infinite credits)
  const agentsSnap = await firestore.collection('agents').get();
  const agentReset = {
    balance: 0, gifted: 0,
    earnedBetting: 0, earnedTasks: 0,
    spentBetting: 0, spentTokens: 0,
    withdrawnUsdc: FieldValue.delete(),
  };
  for (let i = 0; i < agentsSnap.docs.length; i += 400) {
    const batch = firestore.batch();
    agentsSnap.docs.slice(i, i + 400).forEach(d => {
      if (d.id !== 'user') batch.update(d.ref, agentReset);
    });
    await batch.commit();
  }

  // Reset market AMM state
  const marketsSnap = await firestore.collection('markets').get();
  for (let i = 0; i < marketsSnap.docs.length; i += 400) {
    const batch = firestore.batch();
    marketsSnap.docs.slice(i, i + 400).forEach(d => batch.update(d.ref, { liquidity: 0, shares: [0, 0] }));
    await batch.commit();
  }

  // Delete position/trade/financial history collections
  await Promise.all([
    deleteCollection('positions'),
    deleteCollection('trades'),
    deleteCollection('deposits'),
    deleteCollection('withdrawals'),
  ]);

  res.json({ ok: true });
}));
