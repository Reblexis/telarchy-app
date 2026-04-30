import { Router } from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { agents, markets, positions, trades, workspaces } from '../db/schema';
import { wrap } from '../lib/wrap';
import { computeLeaderboard } from '../lib/leaderboard';

/**
 * Cross-workspace participant leaderboard. Public (no auth). Aggregates only
 * over markets in public-visibility workspaces, matching the privacy contract
 * of /api/marketplace: anything inside a private workspace stays inside.
 *
 * The math (calibration / accuracy / earnings / ranking rules) lives in
 * lib/leaderboard.ts so it can be unit-tested without a DB.
 */
export const leaderboardRouter = Router();

leaderboardRouter.get('/', wrap(async (req, res) => {
  const limit = (() => {
    const raw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
    if (!Number.isFinite(raw) || raw <= 0) return 100;
    return Math.min(raw, 500);
  })();

  const publicWs = await db.select({ id: workspaces.id })
    .from(workspaces).where(eq(workspaces.visibility, 'public'));
  if (publicWs.length === 0) { res.json({ participants: [] }); return; }
  const publicWsIds = publicWs.map(w => w.id);

  const wsMarkets = await db.select({
    id: markets.id,
    workspaceId: markets.workspaceId,
    rangeMin: markets.rangeMin,
    rangeMax: markets.rangeMax,
    resolved: markets.resolved,
    actualValue: markets.actualValue,
  }).from(markets).where(and(
    inArray(markets.workspaceId, publicWsIds),
    eq(markets.voided, false),
  ));
  if (wsMarkets.length === 0) { res.json({ participants: [] }); return; }

  const [tradeRows, positionRows] = await Promise.all([
    db.select({
      agentId: trades.agentId,
      workspaceId: trades.workspaceId,
      marketId: trades.marketId,
      cost: trades.cost,
      createdAt: trades.createdAt,
    }).from(trades).where(inArray(trades.workspaceId, publicWsIds)),
    db.select({
      agentId: positions.agentId,
      workspaceId: positions.workspaceId,
      marketId: positions.marketId,
      direction: positions.direction,
      shares: positions.shares,
    }).from(positions).where(inArray(positions.workspaceId, publicWsIds)),
  ]);

  const agentIdsSeen = new Set<string>();
  for (const t of tradeRows) agentIdsSeen.add(t.agentId);
  for (const p of positionRows) agentIdsSeen.add(p.agentId);
  if (agentIdsSeen.size === 0) { res.json({ participants: [] }); return; }

  const agentRows = await db.select({ id: agents.id, nickname: agents.nickname })
    .from(agents).where(inArray(agents.id, Array.from(agentIdsSeen)));
  const nicknameById = new Map(agentRows.map(a => [a.id, a.nickname]));

  const ranked = computeLeaderboard(wsMarkets, tradeRows, positionRows, nicknameById, limit);
  res.json({ participants: ranked });
}));
