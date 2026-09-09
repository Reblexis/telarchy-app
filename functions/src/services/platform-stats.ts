import { and, count, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  agents,
  earnClaims,
  liquidityPurchases,
  markets,
  proposals,
  recordLinks,
  trades,
  workspaces,
} from '../db/schema';
import { loadSeasonMarked } from '../lib/board';
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
 * The verified set: participants whose Manifold record we PAID for.
 *
 * Deliberately `earn_claims` rather than the `record_links` badge table.
 * Since 2026-09-02 anyone can link an account they can prove they hold,
 * qualified or not (docs/record-links.md), so the badge is no longer a
 * quality signal: a Manifold account opened this morning can wear one.
 * The trader count is public and a market resolves against it, so it
 * keeps counting exactly the set it always counted, which is the one a
 * farmer cannot enter cheaply. The linked count (`linkedManifoldCount`)
 * is the other question and reads the badge table on purpose.
 *
 * This is the one place the set is defined. Three readers had it inlined
 * as a `system_config` key prefix; migration 0100 emptied that prefix on
 * 2026-09-01 and every one of them silently read zero for sixteen hours,
 * settling two daily markets on nothing
 * (notes/verified-traders-zero-2026-09-02.md).
 */
export const MANIFOLD_PAID_KEY = 'manifold_link';

/** How many participants have been paid for a Manifold record. */
export async function paidManifoldLinkCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(earnClaims).where(eq(earnClaims.key, MANIFOLD_PAID_KEY));
  return Number(row?.n ?? 0);
}

/** Which of these participants are in the verified set. */
export async function paidManifoldLinkAgents(agentIds: string[]): Promise<Set<string>> {
  if (agentIds.length === 0) return new Set();
  const rows = await db
    .select({ agentId: earnClaims.agentId })
    .from(earnClaims)
    .where(and(eq(earnClaims.key, MANIFOLD_PAID_KEY), inArray(earnClaims.agentId, agentIds)));
  return new Set(rows.map(r => r.agentId));
}

/**
 * The linked set: participants who wear a Manifold link, paid or not.
 *
 * A different question from the verified set above, and kept apart on
 * purpose (docs/metrics.md, "Manifold accounts linked"). The public market
 * that resolves on `manifoldImportCount` asks how many Manifold users will
 * LINK their account, so it counts links: the owner's own five-day-old
 * account, linked and unpaid, read as nothing under the paid definition
 * (owner decision 2026-09-02). A fresh account moves this number and never
 * the trader count.
 */
export async function linkedManifoldCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(recordLinks).where(eq(recordLinks.provider, 'manifold'));
  return Number(row?.n ?? 0);
}

/** How soon after its workspace a proposal has to appear to be the template's
 *  own starter rather than something the owner wrote. */
export const STARTER_PROPOSAL_WINDOW_MS = 10 * 60 * 1000;

/**
 * The starter proposal every new workspace is seeded with
 * (services/workspace-create.ts) is proposed in the owner's name within the
 * same second the workspace is created. Approving it is trying the button,
 * not deciding an action, so it never counts as an outside owner deciding
 * (owner report 2026-09-08: "why does it say 1 .. i think its 0").
 */
export function isStarterProposal(p: {
  proposedBy: string;
  owner: string;
  proposalCreatedAt: Date;
  workspaceCreatedAt: Date;
}): boolean {
  const sinceBirth = p.proposalCreatedAt.getTime() - p.workspaceCreatedAt.getTime();
  return p.proposedBy === p.owner && sinceBirth >= 0 && sinceBirth < STARTER_PROPOSAL_WINDOW_MS;
}

/**
 * "Outside owners deciding" (docs/metrics.md): distinct workspaces whose
 * owner is not a house account and who approved or declined a proposal on
 * their own floor in the trailing 7 days. A decline is a decision; a pending
 * proposal is not; a decision made on the floor by someone other than its
 * owner is not the owner deciding; approving the template's starter proposal
 * is not deciding an action. House means the platform admin and the
 * platform-operated participants, so Telarchy's own floors never count. It
 * is the number the founder's outreach exists to move, and like the trader
 * count it is public because a market settles on it.
 */
export async function outsideOwnersDeciding7d(): Promise<number> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      workspaceId: proposals.workspaceId,
      resolvedBy: proposals.resolvedBy,
      proposedBy: proposals.proposedBy,
      proposalCreatedAt: proposals.createdAt,
      workspaceCreatedAt: workspaces.createdAt,
      owner: workspaces.createdBy,
      admin: agents.platformAdmin,
      operated: agents.platformOperated,
    })
    .from(proposals)
    .innerJoin(workspaces, eq(workspaces.id, proposals.workspaceId))
    .leftJoin(agents, eq(agents.id, workspaces.createdBy))
    .where(and(inArray(proposals.status, ['approved', 'declined']), gt(proposals.resolvedAt, weekAgo)));
  const deciding = new Set<string>();
  for (const r of rows) {
    if (r.admin === true || r.operated === true) continue;
    if (r.resolvedBy !== r.owner) continue;
    if (isStarterProposal(r)) continue;
    deciding.add(r.workspaceId);
  }
  return deciding.size;
}

/** Credits of profit a participant needs to count as a profitable forecaster. */
export const PROFITABLE_FORECASTER_MIN_CREDITS = 100;

/**
 * Credits a verified participant has to trade in the trailing week to count
 * as an active trader. Signup credits are free, so a one-credit gesture must
 * not count. Exported because the data room's window block publishes the
 * spend of every verified participant against this same line, and a second
 * copy of the number is how a block and the metric beside it start
 * disagreeing (docs/data-room.md).
 */
export const WEEKLY_TRADER_MIN_CREDITS = 100;

/**
 * "Profitable forecasters" (docs/metrics.md): participants whose trading
 * profit, marked to market, is at least 100 credits over the markets that
 * resolved in the trailing 30 days plus every market still open, house
 * excluded. Unsettled profit counts: an open position is valued at what the
 * market currently calls (owner decision 2026-09-08, "it could be unsettled
 * profit .. that counts too"). Bots count exactly like humans; nobody has to
 * link anything, because a market is close to zero-sum and a farm of accounts
 * cannot all be profitable. The arithmetic is the board's (lib/board.ts), so
 * this number and the leaderboard can never disagree about a trader; only the
 * window and the threshold are decided here.
 */
export interface PlatformMarkedProfit {
  /** agentId -> marked profit over the window, house included. */
  profit: Map<string, number>;
  /** The platform's own accounts, which no count of forecasters includes. */
  houseIds: Set<string>;
}

async function computeMarkedProfit(now: Date): Promise<PlatformMarkedProfit> {
  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  // Far enough ahead that every open market's settlement falls inside it, so
  // the open half marks every held position rather than only the ones
  // settling soon.
  const windowEnd = new Date(now.getTime() + 366 * 24 * 60 * 60 * 1000);
  const [allWs, house] = await Promise.all([
    db.select({ id: workspaces.id }).from(workspaces),
    db
      .select({ id: agents.id })
      .from(agents)
      .where(sql`${agents.platformAdmin} = true or ${agents.platformOperated} = true`),
  ]);
  const profit = await loadSeasonMarked(
    allWs.map(w => w.id),
    windowStart,
    windowEnd,
  );
  return { profit, houseIds: new Set(house.map(h => h.id)) };
}

/**
 * One board pass over every workspace, cached for a minute.
 *
 * Two public surfaces need it in the same breath: the metric (the count at or
 * above the threshold) and the data room's window block (the distribution
 * itself). It is the heaviest read either of them does, so it is computed
 * once and shared, which also makes it impossible for the count and the
 * distribution beside it to disagree. A caller that names its own `now`
 * (tests, and anything reconstructing a past instant) bypasses the cache.
 */
const markedCache = ttlCache({
  ttlMs: 60_000,
  keyOf: () => 'marked',
  load: () => computeMarkedProfit(new Date()),
});

export function platformMarkedProfit(now?: Date): Promise<PlatformMarkedProfit> {
  return now ? computeMarkedProfit(now) : markedCache.get();
}

export async function profitableForecasters30d(now?: Date): Promise<number> {
  const { profit, houseIds } = await platformMarkedProfit(now);
  let n = 0;
  for (const [agentId, p] of profit) {
    if (houseIds.has(agentId)) continue;
    if (p >= PROFITABLE_FORECASTER_MIN_CREDITS) n += 1;
  }
  return n;
}

export interface PlatformStats {
  marketsActive: number;
  agentsActive: number;
  tradesThisWeek: number;
  weeklyActiveVerifiedTraders: number;
  /** docs/metrics.md, "Outside owners deciding": outside workspaces whose
   *  owner decided a proposal in the trailing 7 days. */
  outsideOwnersDeciding: number;
  /** docs/metrics.md, "Profitable forecasters": participants at or above 100
   *  credits of marked-to-market profit over the trailing 30 days' resolutions
   *  and every open market, house excluded. */
  profitableForecasters: number;
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
  const spendByAgent = await db
    .select({ id: trades.agentId, spend: sql<number>`sum(abs(${trades.cost}))` })
    .from(trades)
    .where(gt(trades.createdAt, weekAgo))
    .groupBy(trades.agentId);
  const qualifying = spendByAgent.filter(r => Number(r.spend) >= WEEKLY_TRADER_MIN_CREDITS).map(r => r.id);
  const weeklyActiveVerifiedTraders = (await paidManifoldLinkAgents(qualifying)).size;
  const outsideOwnersDeciding = await outsideOwnersDeciding7d();
  const profitableForecasters = await profitableForecasters30d();

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

  // Platform-wide count of linked Manifold accounts, paid or not. It is a
  // platform number rather than a property of any one workspace, and a
  // public prediction market resolves against it.
  const manifoldImportCount = await linkedManifoldCount();

  // The revenue rail, public for the same reason the trader count is: the
  // floor prices "Telarchy revenue (USD)" and a market cannot resolve on a
  // number only the owner can see. Dated by when the money actually landed
  // (`completedAt`), falling back to the row's creation for pre-`completedAt`
  // rows, which is the same window `GET /api/liquidity/revenue` reports.
  // Purchases by the house (platform-admin accounts) are left out: the
  // operator paying itself is not revenue (docs/metrics.md, owner report
  // 2026-09-02, when the floor's whole $5 was the owner's own card). A
  // buyer with no agents row still counts, hence the left join.
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const paid = await db
    .select({
      usdAmount: liquidityPurchases.usdAmount,
      completedAt: liquidityPurchases.completedAt,
      createdAt: liquidityPurchases.createdAt,
      house: agents.platformAdmin,
    })
    .from(liquidityPurchases)
    .leftJoin(agents, eq(agents.id, liquidityPurchases.agentId))
    .where(eq(liquidityPurchases.status, 'completed'));
  const revenue30dUsd = paid
    .filter(r => r.house !== true && new Date(r.completedAt ?? r.createdAt) >= monthAgo)
    .reduce((sum, r) => sum + Number(r.usdAmount), 0);

  return {
    marketsActive,
    agentsActive: Number(agentCount.count),
    tradesThisWeek,
    weeklyActiveVerifiedTraders,
    outsideOwnersDeciding,
    profitableForecasters,
    manifoldImportCount,
    revenue30dUsd,
  };
}
