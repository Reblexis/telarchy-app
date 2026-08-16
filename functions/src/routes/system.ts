import { Router } from 'express';
import { db } from '../db/client';
import { agentApiKeys, agents, markets, positions, trades, deposits, withdrawals, systemConfig } from '../db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { wrap } from '../lib/wrap';
import { requireCapability } from '../middleware/roles';
import { getAllMetrics, getStatus, getAllMetricLogsGrouped } from '../services/metrics';
import { consensus, pHigher } from '../lib/amm';
import { isUsdcSettlementEnabled } from '../lib/settlement';
import { resolutionInstant } from '../lib/date-utils';
import { allowLedgerAdmin } from '../lib/ledger-admin';

export const systemRouter = Router();

async function getEconomy() {
  const [row] = await db.select().from(systemConfig).where(eq(systemConfig.key, 'economy'));
  if (!row) return { creditValueUsd: null };
  const val = row.value as { creditValueUsd?: number };
  return { creditValueUsd: val.creditValueUsd ?? null };
}

systemRouter.get('/status', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const includeTrends = req.query.trends === '1';
  const includeMarkets = req.query.markets === '1';
  const trendsLimit = typeof req.query.trendsLimit === 'string'
    ? Math.min(Math.max(1, parseInt(req.query.trendsLimit, 10) || 20), 90)
    : 20;

  const [allMetrics, economy] = await Promise.all([getAllMetrics(workspaceId), getEconomy()]);
  const base = { ...getStatus(allMetrics), ...economy, usdcSettlementEnabled: isUsdcSettlementEnabled() };

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

  type MarketRow = { id: string; metricId: string; targetDate: string; shares: unknown; liquidity: number; rangeMin: number; rangeMax: number; proposalId: string | null; active: boolean };

  // Group open markets by metricId (exclude proposal-scoped and inactive)
  const marketsByMetricId: Record<string, MarketRow[]> = {};
  if (openMarketRows) {
    for (const m of openMarketRows as MarketRow[]) {
      if (m.proposalId || !m.active) continue;
      if (!marketsByMetricId[m.metricId]) marketsByMetricId[m.metricId] = [];
      marketsByMetricId[m.metricId].push(m);
    }
  }

  const augmented = base.metrics.map(m => {
    const result: Record<string, unknown> = { ...m };

    if (includeTrends && logsGrouped) {
      const logs = (logsGrouped[m.id] ?? []).slice(-trendsLimit);
      // Sparkline prefers outlook (composite total / leaf+TP blend) when stored,
      // falls back to the raw value for pre-0018 rows and leaves without TP.
      result.trend = logs.map(l => [Math.floor(new Date(l.timestamp).getTime() / 1000), l.outlook ?? l.value] as [number, number]);
    }

    if (includeMarkets) {
      const mrkts = (marketsByMetricId[m.id] ?? [])
        .sort((a, b) => a.targetDate.localeCompare(b.targetDate))
        .map(mk => {
          const s = (mk.shares as [number, number]) || [0, 0];
          return {
            id: mk.id,
            targetDate: mk.targetDate,
            resolvesOn: resolutionInstant(mk.targetDate),
            prediction: consensus(s, mk.liquidity, mk.rangeMin, mk.rangeMax) ?? null,
            probability: Math.round(pHigher(s, mk.liquidity) * 10000) / 10000,
            // Bots size trades and thresholds relative to the range; without
            // these the one-call snapshot cannot drive a trade decision.
            rangeMin: mk.rangeMin,
            rangeMax: mk.rangeMax,
          };
        });
      result.markets = mrkts;
    }

    return result;
  });

  res.json({ ...base, metrics: augmented });
}));

systemRouter.post('/reset-economy', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;

  await db.transaction(async tx => {
    // Resolve agents scoped to this workspace via agentApiKeys
    const keyRows = await tx.select({ agentId: agentApiKeys.agentId }).from(agentApiKeys)
      .where(eq(agentApiKeys.workspaceId, workspaceId));
    const wsAgentIds = [...new Set(keyRows.map(r => r.agentId))];

    if (wsAgentIds.length) {
      await tx.update(agents).set({
        balance: 0, earnedBetting: 0,
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
    // A workspace reset wipes its trading history on purpose.
    await allowLedgerAdmin(tx);
    await tx.delete(trades).where(eq(trades.workspaceId, workspaceId));
  });

  res.json({ ok: true });
}));
