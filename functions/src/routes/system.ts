import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { markets, systemConfig } from '../db/schema';
import { consensus, pHigher } from '../lib/amm';
import { resolutionInstant } from '../lib/date-utils';
import { isUsdcSettlementEnabled } from '../lib/settlement';
import { wrap } from '../lib/wrap';
import { requireCapability } from '../middleware/roles';
import { listEarnRules } from '../services/earnRules';
import { getAllMetricLogsGrouped, getAllMetrics, getStatus } from '../services/metrics';

export const systemRouter = Router();

async function getEconomy() {
  const [row] = await db.select().from(systemConfig).where(eq(systemConfig.key, 'economy'));
  if (!row) return { creditValueUsd: null };
  const val = row.value as { creditValueUsd?: number };
  return { creditValueUsd: val.creditValueUsd ?? null };
}

systemRouter.get(
  '/status',
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const includeTrends = req.query.trends === '1';
    const includeMarkets = req.query.markets === '1';
    const trendsLimit =
      typeof req.query.trendsLimit === 'string'
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
        ? db
            .select()
            .from(markets)
            .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)))
        : Promise.resolve(null),
    ]);

    type MarketRow = {
      id: string;
      metricId: string;
      targetDate: string;
      shares: unknown;
      liquidity: number;
      rangeMin: number;
      rangeMax: number;
      proposalId: string | null;
      active: boolean;
    };

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
        result.trend = logs.map(
          l => [Math.floor(new Date(l.timestamp).getTime() / 1000), l.outlook ?? l.value] as [number, number],
        );
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
  }),
);

/*
 * POST /api/system/reset-economy is GONE (owner decision 2026-08-18).
 *
 * It zeroed every balance in a workspace, deleted every trade under
 * allowLedgerAdmin, and reset all market AMM state, behind nothing but the
 * ordinary `manage` capability. It was built when the data was fake. With a
 * prize season running against real money it was one mistyped workspace
 * header away from ending the season with no way to reconstruct what had
 * happened, and the append-only trigger could not stop it because it opted
 * out of the trigger on purpose.
 *
 * Deleted rather than guarded: a guard has to be remembered, and this endpoint
 * has no legitimate use on a live product. Starting a workspace over is
 * DELETE /api/workspaces/:id followed by creating a new one, which is gated on
 * manage_workspace and voids and refunds every open position on the way out.
 *
 * Governing doc: docs/market-integrity.md.
 */

/**
 * The earn table, public (owner decision 2026-08-30). Anyone can read how
 * free credits are earned and what each way is worth right now: a contest
 * whose grants decide standings owes its entrants that, and the operator
 * edits these prices live, mid-season included.
 */
systemRouter.get(
  '/earn',
  wrap(async (_req, res) => {
    const rules = await listEarnRules();
    res.json({
      rules: rules
        .filter(r => r.enabled)
        .map(r => ({ key: r.key, label: r.label, credits: r.credits, kind: r.kind, note: r.note })),
    });
  }),
);
