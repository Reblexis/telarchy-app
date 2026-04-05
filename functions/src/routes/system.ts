import { Router } from 'express';
import { db } from '../db/client';
import { agentApiKeys, agents, markets, positions, trades, deposits, withdrawals, systemConfig } from '../db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { wrap } from '../lib/wrap';
import { requireRole } from '../middleware/roles';
import { getAllMetrics, getStatus, getAllMetricLogsGrouped } from '../services/metrics';
import { consensus, pHigher } from '../lib/amm';

export const systemRouter = Router();

async function getEconomy() {
  const [row] = await db.select().from(systemConfig).where(eq(systemConfig.key, 'economy'));
  if (!row) return { creditValueUsd: null };
  const val = row.value as { creditValueUsd?: number };
  return { creditValueUsd: val.creditValueUsd ?? null };
}

systemRouter.get('/status', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const includeTrends = req.query.trends === '1';
  const includeMarkets = req.query.markets === '1';
  const trendsLimit = typeof req.query.trendsLimit === 'string'
    ? Math.min(Math.max(1, parseInt(req.query.trendsLimit, 10) || 20), 90)
    : 20;

  const [allMetrics, economy] = await Promise.all([getAllMetrics(workspaceId), getEconomy()]);
  const base = { ...getStatus(allMetrics), ...economy };

  if (!includeTrends && !includeMarkets) {
    res.json(base);
    return;
  }

  const [logsGrouped, openMarketRows] = await Promise.all([
    includeTrends ? getAllMetricLogsGrouped(workspaceId) : Promise.resolve(null),
    includeMarkets
      ? db.select().from(markets).where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)))
      : Promise.resolve(null),
  ]);

  type MarketRow = { id: string; metricId: string; targetDate: string; shares: unknown; liquidity: number; rangeMin: number; rangeMax: number; taskId: string | null; active: boolean };

  // Group open markets by metricId (exclude task-scoped and inactive)
  const marketsByMetricId: Record<string, MarketRow[]> = {};
  if (openMarketRows) {
    for (const m of openMarketRows as MarketRow[]) {
      if (m.taskId || !m.active) continue;
      if (!marketsByMetricId[m.metricId]) marketsByMetricId[m.metricId] = [];
      marketsByMetricId[m.metricId].push(m);
    }
  }

  const augmented = base.metrics.map(m => {
    const result: Record<string, unknown> = { ...m };

    if (includeTrends && logsGrouped) {
      const logs = (logsGrouped[m.id] ?? []).slice(-trendsLimit);
      result.trend = logs.map(l => [Math.floor(new Date(l.timestamp).getTime() / 1000), l.value] as [number, number]);
    }

    if (includeMarkets) {
      const mrkts = (marketsByMetricId[m.id] ?? [])
        .sort((a, b) => a.targetDate.localeCompare(b.targetDate))
        .map(mk => {
          const s = (mk.shares as [number, number]) || [0, 0];
          return {
            id: mk.id,
            targetDate: mk.targetDate,
            prediction: consensus(s, mk.liquidity, mk.rangeMin, mk.rangeMax) ?? null,
            probability: Math.round(pHigher(s, mk.liquidity) * 10000) / 10000,
          };
        });
      result.markets = mrkts;
    }

    return result;
  });

  res.json({ ...base, metrics: augmented });
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
