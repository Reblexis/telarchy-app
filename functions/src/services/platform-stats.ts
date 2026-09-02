import { and, count, eq, gt, inArray, like, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { agents, liquidityPurchases, markets, systemConfig, trades, workspaces } from '../db/schema';
import { ttlCache } from '../lib/ttl-cache';

/**
 * The platform's own pulse, in one place.
 *
 * Two public surfaces publish these numbers: `GET /api/marketplace/stats`,
 * which is the route a market on this platform resolves against, and the data
 * room, which explains what they mean. A second copy of the arithmetic is how
 * the resolution source and the page describing it start disagreeing, so there
 * is one function and both call it. See docs/data-room.md.
 */
/**
 * Where a paid Manifold link lives: `record-handle:manifold:<agentId>`, as
 * the record-link router writes it (routes/recordLinks.ts, `handleKey`).
 * Every count of "verified" participants on the platform reads this prefix
 * and no other, so the stats route, the public floor and the data room
 * cannot disagree about who is verified.
 */
export const MANIFOLD_HANDLE_PREFIX = 'record-handle:manifold:';

export interface PlatformStats {
  marketsActive: number;
  agentsActive: number;
  tradesThisWeek: number;
  weeklyActiveVerifiedTraders: number;
  manifoldImportCount: number;
  /**
   * Money Telarchy itself was paid in the trailing 30 days, USD
   * (docs/metrics.md, "Revenue, trailing 30 days"). Every rail that exists
   * today is a completed liquidity purchase, so this is their sum; a second
   * rail is added to this number, not to a second field, because the metric
   * it resolves is total revenue.
   */
  revenue30dUsd: number;
}

/**
 * Cached one minute: `GET /api/marketplace/stats` is public and was the only
 * public aggregate with no cache at all, an N+1 over every workspace on each
 * request. A market resolving against these numbers reads a value at most 60s
 * old, which is inside the noise of the weekly windows they measure.
 */
const statsCache = ttlCache({
  ttlMs: 60_000,
  keyOf: () => 'stats',
  load: () => computePlatformStats(),
});

/** Test seam. */

export function platformStats(): Promise<PlatformStats> {
  return statsCache.get();
}

async function computePlatformStats(): Promise<PlatformStats> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const allWs = await db.select({ id: workspaces.id }).from(workspaces);

  const [agentCount] = await db.select({ count: count() }).from(agents);

  // The hero metric of the Telarchy dogfooding workspace (2026-08-14):
  // distinct participants who (a) have a Manifold account synced (the
  // verified set: each maps to a public Manifold profile anyone can check,
  // surfaced on the leaderboard) and (b) placed trades totalling at least
  // 100 credits across the trailing 7 days (credits are free, so a costless
  // gesture must not count; abs(cost) so sells are activity too). It is
  // public for the same reason manifoldImportCount is: a resolution source
  // has to be readable by the people being asked to trust it.
  //
  // "Synced" is a `record-handle:manifold:<agentId>` row, the row the
  // record-link router writes when a link is paid (docs/record-links.md) and
  // the only key shape since migration 0100. That migration rewrote the old
  // `manifold-claimed:agent:` rows and deleted them while this read still
  // named the old key, and the floor said zero traders for sixteen hours
  // (2026-09-01 18:40 UTC). One shape, read from one constant.
  const spendByAgent = await db
    .select({ id: trades.agentId, spend: sql<number>`sum(abs(${trades.cost}))` })
    .from(trades)
    .where(gt(trades.createdAt, weekAgo))
    .groupBy(trades.agentId);
  const qualifying = spendByAgent.filter(r => Number(r.spend) >= 100).map(r => r.id);
  const claimedRows =
    qualifying.length > 0
      ? await db
          .select({ key: systemConfig.key })
          .from(systemConfig)
          .where(
            inArray(
              systemConfig.key,
              qualifying.map(id => `${MANIFOLD_HANDLE_PREFIX}${id}`),
            ),
          )
      : [];
  const weeklyActiveVerifiedTraders = claimedRows.length;

  let marketsActive = 0;
  let tradesThisWeek = 0;

  await Promise.all(
    allWs.map(async ws => {
      const [mCount, tCount] = await Promise.all([
        db
          .select({ count: count() })
          .from(markets)
          .where(and(eq(markets.workspaceId, ws.id), eq(markets.resolved, false), eq(markets.active, true)))
          .then(r => r[0]?.count ?? 0),
        db
          .select({ count: count() })
          .from(trades)
          .where(and(eq(trades.workspaceId, ws.id), gt(trades.createdAt, weekAgo)))
          .then(r => r[0]?.count ?? 0),
      ]);
      marketsActive += Number(mCount);
      tradesThisWeek += Number(tCount);
    }),
  );

  // Platform-wide count of completed Manifold imports. It is a platform
  // number rather than a property of any one workspace, and a public
  // prediction market resolves against it.
  const [manifoldRow] = await db
    .select({ n: count() })
    .from(systemConfig)
    .where(like(systemConfig.key, `${MANIFOLD_HANDLE_PREFIX}%`));

  // The revenue rail, public for the same reason the trader count is: the
  // floor prices "Telarchy revenue (USD)" and a market cannot resolve on a
  // number only the owner can see. Dated by when the money actually landed
  // (`completedAt`), falling back to the row's creation for pre-`completedAt`
  // rows, which is the same window `GET /api/liquidity/revenue` reports.
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const paid = await db
    .select({
      usdAmount: liquidityPurchases.usdAmount,
      completedAt: liquidityPurchases.completedAt,
      createdAt: liquidityPurchases.createdAt,
    })
    .from(liquidityPurchases)
    .where(eq(liquidityPurchases.status, 'completed'));
  const revenue30dUsd = paid
    .filter(r => new Date(r.completedAt ?? r.createdAt) >= monthAgo)
    .reduce((sum, r) => sum + Number(r.usdAmount), 0);

  return {
    marketsActive,
    agentsActive: Number(agentCount.count),
    tradesThisWeek,
    weeklyActiveVerifiedTraders,
    manifoldImportCount: Number(manifoldRow?.n ?? 0),
    revenue30dUsd,
  };
}
