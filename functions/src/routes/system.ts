import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../lib/db';
import { wsCol } from '../lib/workspace';
import { wrap } from '../lib/wrap';
import { requireRole } from '../middleware/roles';
import { getAllMetrics, getStatus } from '../services/metrics';

export const systemRouter = Router();

async function getEconomy() {
  const doc = await db().collection('_system').doc('economy').get();
  if (!doc.exists) return { creditValueUsd: null };
  const { creditValueUsd = null } = doc.data()!;
  return { creditValueUsd };
}

systemRouter.get('/status', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const [metrics, economy] = await Promise.all([getAllMetrics(workspaceId), getEconomy()]);
  res.json({ ...getStatus(metrics), ...economy });
}));

// Wipe all agent balances/stats, market AMM state, positions, trades, deposits, and withdrawals.
// Markets themselves are kept (with zeroed liquidity) so admin doesn't need to recreate them.
systemRouter.post('/reset-economy', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const firestore = db();

  async function deleteWsCollection(name: string) {
    let snapshot = await wsCol(workspaceId, name).limit(400).get();
    while (!snapshot.empty) {
      const batch = firestore.batch();
      snapshot.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      snapshot = await wsCol(workspaceId, name).limit(400).get();
    }
  }

  // Reset all agent balances — agents is a global collection, not workspace-scoped
  const agentsSnap = await firestore.collection('agents').get();
  const agentReset = {
    balance: 0, gifted: 0,
    earnedBetting: 0, earnedTasks: 0,
    spentBetting: 0, spentTokens: 0,
    withdrawnUsdc: FieldValue.delete(),
  };
  for (let i = 0; i < agentsSnap.docs.length; i += 400) {
    const batch = firestore.batch();
    agentsSnap.docs.slice(i, i + 400).forEach(d => batch.update(d.ref, agentReset));
    await batch.commit();
  }

  // Reset market AMM state
  const marketsSnap = await wsCol(workspaceId, 'markets').get();
  for (let i = 0; i < marketsSnap.docs.length; i += 400) {
    const batch = firestore.batch();
    marketsSnap.docs.slice(i, i + 400).forEach(d => batch.update(d.ref, { liquidity: 0, shares: [0, 0] }));
    await batch.commit();
  }

  // Delete position/trade/financial history collections
  await Promise.all([
    deleteWsCollection('positions'),
    deleteWsCollection('trades'),
    // deposits and withdrawals are global — not workspace-scoped
    firestore.collection('deposits').limit(400).get().then(async snap => {
      while (!snap.empty) {
        const batch = firestore.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        snap = await firestore.collection('deposits').limit(400).get();
      }
    }),
    firestore.collection('withdrawals').limit(400).get().then(async snap => {
      while (!snap.empty) {
        const batch = firestore.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        snap = await firestore.collection('withdrawals').limit(400).get();
      }
    }),
  ]);

  res.json({ ok: true });
}));
