import { Router } from 'express';
import { db } from '../db/client';
import { agentApiKeys, agents, markets, positions, trades, deposits, withdrawals, systemConfig } from '../db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { wrap } from '../lib/wrap';
import { requireRole } from '../middleware/roles';
import { getAllMetrics, getStatus } from '../services/metrics';

export const systemRouter = Router();

async function getEconomy() {
  const [row] = await db.select().from(systemConfig).where(eq(systemConfig.key, 'economy'));
  if (!row) return { creditValueUsd: null };
  const val = row.value as { creditValueUsd?: number };
  return { creditValueUsd: val.creditValueUsd ?? null };
}

systemRouter.get('/status', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const [allMetrics, economy] = await Promise.all([getAllMetrics(workspaceId), getEconomy()]);
  res.json({ ...getStatus(allMetrics), ...economy });
}));

systemRouter.post('/reset-economy', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;

  await db.transaction(async tx => {
    // Resolve agents scoped to this workspace via agentApiKeys
    const keyRows = await tx.select({ agentId: agentApiKeys.agentId }).from(agentApiKeys)
      .where(eq(agentApiKeys.workspaceId, workspaceId));
    const wsAgentIds = [...new Set(keyRows.map(r => r.agentId))];

    if (wsAgentIds.length) {
      await tx.update(agents).set({
        balance: 0, earnedBetting: 0, earnedTasks: 0,
        spentBetting: 0, spentTokens: 0, withdrawnUsdc: 0,
      }).where(inArray(agents.id, wsAgentIds));
      await tx.delete(deposits).where(inArray(deposits.agentId, wsAgentIds));
      await tx.delete(withdrawals).where(inArray(withdrawals.agentId, wsAgentIds));
    }

    // Reset market AMM state (workspace-scoped)
    await tx.update(markets)
      .set({ liquidity: 0, pool: 0, shares: [0, 0] as [number, number] })
      .where(eq(markets.workspaceId, workspaceId));

    // Delete workspace-scoped financial data
    await tx.delete(positions).where(eq(positions.workspaceId, workspaceId));
    await tx.delete(trades).where(eq(trades.workspaceId, workspaceId));
  });

  res.json({ ok: true });
}));
