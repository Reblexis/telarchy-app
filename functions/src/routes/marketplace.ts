import { randomUUID } from 'crypto';
import { and, asc, desc, eq, gt, gte, inArray, ne, sql } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import {
  announcements,
  floorQuestions,
  liquidityEvents,
  marketMessages,
  markets,
  metricLogs,
  metrics,
  permissionGroups,
  positions,
  proposalMessages,
  proposalRevisions,
  proposals,
  trades,
  workspaces,
} from '../db/schema';
import { consensus, pHigher } from '../lib/amm';
import { type AskTurn, askAboutWorkspace, askEnabled } from '../lib/ask';
import { type BaselineOrderKey, compareSoonestFirst, primaryOf } from '../lib/baseline-order';
import { type ContractorEntry, type ContractorJobPair, computeContractors } from '../lib/contractors';
import { periodEndInstant, periodStartInstant, resolutionInstant, settlesOn } from '../lib/date-utils';
import { branchIsShown } from '../lib/market-pairs';
import { getGroupMemberIds, getOwnerHandles, getParticipantDisplayNames } from '../lib/participants';
import { restrictedToMembers } from '../lib/public-read';
import { listPublicSeasons, type PublicSeason } from '../lib/public-seasons';
import { AGENT_SIGNUP_CREDITS, SIGNUP_CREDITS } from '../lib/validation';
import { wrap } from '../lib/wrap';
import { authMiddleware, getAuthWorkspaceMemberships } from '../middleware/auth';
import { requireIdentity } from '../middleware/roles';
import { dataRoomTool } from '../services/data-room';
import { type ApiCallRecord, ottoApiTools } from '../services/otto-tools';
import { linkedManifoldCount, platformStats } from '../services/platform-stats';
import { marketPriceSeries } from '../services/predictions';
import { webSearchTool } from '../services/web-search';
import { buildWorkspaceContext, renderContextIndex, renderContextMarkdown } from '../services/workspace-context';
import { ensureSystemGroups } from './groups';

export const marketplaceRouter = Router();

/**
 * Which of a workspace's open markets is THE number: the furthest-resolving
 * one (owner direction 2026-08-16). It is what the owner is actually judged
 * on: LookPilot is "net 2026 at $78,571", not "$213 so far this week".
 * Marketplace cards, the share card, the trader context and the contractor
 * score all read this, so a visitor meets the same headline wherever they
 * arrive, and the floor opens on this market.
 *
 * Lists arrive soonest-first under `compareSoonestFirst` (lib/baseline-order),
 * so the primary is the last element, and a tie on the settle instant between
 * two metrics goes to the lower metric `order`. The frontend mirror is
 * `primaryHorizonOf` in lib/floor-horizons; the two must agree or a card and
 * its floor name different numbers.
 */
const primaryMarket = primaryOf;

/** Metric display order per id, the tie-breaker `compareSoonestFirst` reads. */
async function metricOrdersOf(workspaceIds: string[]): Promise<Map<string, number>> {
  if (workspaceIds.length === 0) return new Map();
  const rows = await db
    .select({ id: metrics.id, order: metrics.order })
    .from(metrics)
    .where(inArray(metrics.workspaceId, workspaceIds));
  return new Map(rows.map(r => [r.id, r.order]));
}

marketplaceRouter.get(
  '/',
  wrap(async (req, res) => {
    const limit = typeof req.query.limit === 'string' ? Math.min(parseInt(req.query.limit, 10), 100) : 50;

    const publicWs = await db
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.visibility, 'public'));

    if (publicWs.length === 0) {
      res.json([]);
      return;
    }

    const allMarkets: Array<Record<string, unknown>> = [];
    const orders = await metricOrdersOf(publicWs.map(w => w.id));

    await Promise.all(
      publicWs.map(async ws => {
        const wsMarkets = await db
          .select()
          .from(markets)
          .where(and(eq(markets.workspaceId, ws.id), eq(markets.resolved, false), eq(markets.active, true)));

        for (const m of wsMarkets) {
          if (m.proposalId) continue;
          const shares = (m.shares as [number, number]) || [0, 0];
          allMarkets.push({
            workspaceId: ws.id,
            workspaceName: ws.name,
            marketId: m.id,
            metricId: m.metricId,
            metricName: m.metricName,
            metricOrder: orders.get(m.metricId) ?? null,
            targetDate: m.targetDate,
            resolvesOn: settlesOn(m),
            consensus: consensus(shares, m.liquidity, m.rangeMin, m.rangeMax) ?? null,
            probability: Math.round(pHigher(shares, m.liquidity) * 10000) / 10000,
            liquidity: m.liquidity,
            // The credits actually in the pool. `liquidity` beside it is the LMSR
            // sensitivity b = pool / ln 2 (docs/vision.md), which the price maths
            // needs and which is NOT what anyone paid in: showing b where credits
            // were meant made a 1,000-credit injection read as 1,443 in the pool
            // (owner report, 2026-08-30).
            pool: m.pool ?? 0,
            rangeMin: m.rangeMin,
            rangeMax: m.rangeMax,
          });
        }
      }),
    );

    // Sort within-workspace soonest-first (lib/baseline-order), then
    // round-robin across workspaces so one prolific workspace doesn't dominate
    // the public marketplace list. Anonymous visitors should see breadth.
    allMarkets.sort((a, b) => compareSoonestFirst(a as unknown as BaselineOrderKey, b as unknown as BaselineOrderKey));
    const byWs: Map<string, Array<Record<string, unknown>>> = new Map();
    for (const m of allMarkets) {
      const wsId = m.workspaceId as string;
      if (!byWs.has(wsId)) byWs.set(wsId, []);
      byWs.get(wsId)!.push(m);
    }
    const interleaved: Array<Record<string, unknown>> = [];
    let added = true;
    while (added && interleaved.length < limit) {
      added = false;
      for (const list of byWs.values()) {
        if (list.length === 0) continue;
        interleaved.push(list.shift()!);
        added = true;
        if (interleaved.length >= limit) break;
      }
    }
    res.json(interleaved);
  }),
);

/**
 * The platform's pulse, and the route a market on this platform resolves
 * against. The arithmetic lives in services/platform-stats.ts because the data
 * room publishes the same numbers with an explanation attached, and a second
 * copy is how a resolution source and the page describing it drift apart.
 */
marketplaceRouter.get(
  '/stats',
  wrap(async (_req, res) => {
    res.json(await platformStats());
  }),
);

marketplaceRouter.get(
  '/featured',
  wrap(async (_req, res) => {
    const publicWs = await db
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.visibility, 'public'));
    if (publicWs.length === 0) {
      res.json([]);
      return;
    }
    const wsById = new Map(publicWs.map(w => [w.id, w.name]));

    const rows = await db
      .select()
      .from(markets)
      .where(
        and(
          inArray(
            markets.workspaceId,
            publicWs.map(w => w.id),
          ),
          eq(markets.featured, true),
          eq(markets.resolved, false),
          eq(markets.active, true),
          eq(markets.voided, false),
        ),
      );

    const featuredOrders = await metricOrdersOf(publicWs.map(w => w.id));
    const out = rows
      .filter(m => !m.proposalId)
      .map(m => {
        const shares = (m.shares as [number, number]) || [0, 0];
        return {
          workspaceId: m.workspaceId,
          workspaceName: wsById.get(m.workspaceId) ?? m.workspaceId,
          marketId: m.id,
          metricId: m.metricId,
          metricName: m.metricName,
          metricOrder: featuredOrders.get(m.metricId) ?? null,
          targetDate: m.targetDate,
          resolvesOn: settlesOn(m),
          consensus: consensus(shares, m.liquidity, m.rangeMin, m.rangeMax) ?? null,
          probability: Math.round(pHigher(shares, m.liquidity) * 10000) / 10000,
          liquidity: m.liquidity,
          // The credits actually in the pool. `liquidity` beside it is the LMSR
          // sensitivity b = pool / ln 2 (docs/vision.md), which the price maths
          // needs and which is NOT what anyone paid in: showing b where credits
          // were meant made a 1,000-credit injection read as 1,443 in the pool
          // (owner report, 2026-08-30).
          pool: m.pool ?? 0,
          tradedVolume: m.tradedVolume,
          rangeMin: m.rangeMin,
          rangeMax: m.rangeMax,
        };
      });

    out.sort(compareSoonestFirst);

    res.json(out);
  }),
);

/**
 * Every public workspace as the listing shows it: the row a visitor sees on
 * the home page before opening a floor. Shared by GET /workspaces/public and
 * the home payload so the two can never drift.
 */
export async function listPublicWorkspaces() {
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      createdBy: workspaces.createdBy,
      description: workspaces.description,
      visibility: workspaces.visibility,
      proposalReward: workspaces.proposalReward,
      spamPenalty: workspaces.spamPenalty,
      maxPendingProposalsPerParticipant: workspaces.maxPendingProposalsPerParticipant,
    })
    .from(workspaces)
    .where(eq(workspaces.visibility, 'public'));

  if (rows.length === 0) return [];

  const ownerHandles = await getOwnerHandles(rows.map(r => r.createdBy));

  const wsIds = rows.map(r => r.id);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const statRows = await db
    .select({
      workspaceId: proposals.workspaceId,
      status: proposals.status,
      n: sql<number>`count(*)::int`,
    })
    .from(proposals)
    .where(and(inArray(proposals.workspaceId, wsIds), gte(proposals.createdAt, since), ne(proposals.status, 'removed')))
    .groupBy(proposals.workspaceId, proposals.status);

  const statsByWs = new Map<
    string,
    { total: number; approved: number; declined: number; declinedSpam: number; withdrawn: number; pending: number }
  >();
  for (const id of wsIds) {
    statsByWs.set(id, { total: 0, approved: 0, declined: 0, declinedSpam: 0, withdrawn: 0, pending: 0 });
  }
  for (const row of statRows) {
    const s = statsByWs.get(row.workspaceId);
    if (!s) continue;
    s.total += row.n;
    if (row.status === 'approved') s.approved += row.n;
    else if (row.status === 'declined') s.declined += row.n;
    else if (row.status === 'declined_spam') s.declinedSpam += row.n;
    else if (row.status === 'withdrawn') s.withdrawn += row.n;
    else if (row.status === 'pending') s.pending += row.n;
  }

  // Activity counts so an agent can tell empty workspaces from active ones in
  // one call, before joining. metricCount = metrics defined; openMarketCount =
  // markets still tradeable (active, not resolved/voided).
  const metricRows = await db
    .select({
      workspaceId: metrics.workspaceId,
      n: sql<number>`count(*)::int`,
    })
    .from(metrics)
    .where(inArray(metrics.workspaceId, wsIds))
    .groupBy(metrics.workspaceId);
  const metricCountByWs = new Map<string, number>(metricRows.map(r => [r.workspaceId, r.n]));

  const openMarketRows = await db
    .select({
      workspaceId: markets.workspaceId,
      n: sql<number>`count(*)::int`,
    })
    .from(markets)
    .where(
      and(
        inArray(markets.workspaceId, wsIds),
        eq(markets.active, true),
        eq(markets.resolved, false),
        eq(markets.voided, false),
      ),
    )
    .groupBy(markets.workspaceId);
  const openMarketCountByWs = new Map<string, number>(openMarketRows.map(r => [r.workspaceId, r.n]));

  return rows.map(r => ({
    workspaceId: r.id,
    name: r.name,
    slug: r.slug,
    ownerId: ownerHandles.get(r.createdBy)?.ownerId ?? null,
    ownerHandle: ownerHandles.get(r.createdBy)?.ownerHandle ?? null,
    description: r.description,
    visibility: r.visibility,
    proposalReward: r.proposalReward,
    spamPenalty: r.spamPenalty,
    maxPendingProposalsPerParticipant: r.maxPendingProposalsPerParticipant,
    metricCount: metricCountByWs.get(r.id) ?? 0,
    openMarketCount: openMarketCountByWs.get(r.id) ?? 0,
    proposalStats: statsByWs.get(r.id)!,
  }));
}

export type PublicListing = Awaited<ReturnType<typeof listPublicWorkspaces>>[number];

marketplaceRouter.get(
  '/workspaces/public',
  wrap(async (_req, res) => {
    res.json(await listPublicWorkspaces());
  }),
);

/**
 * GET /home: the home page in one call. Seasons, every public workspace, and
 * each one's floor payload, so the client paints with data on its first
 * render instead of after three waterfall stages (seasons, the listing, then
 * one floor per row). server.ts inlines the same object into index.html for a
 * full document load of `/`. Registered before `/:workspaceId` so "home" is
 * never read as a slug.
 */
marketplaceRouter.get(
  '/home',
  wrap(async (_req, res) => {
    res.json(await getHomePayload());
  }),
);

/**
 * Resolve a share-link segment to a non-private workspace: by id first, then
 * by slug among public/unlisted workspaces. The slug form exists because the
 * share link is the product's front door and a UUID in it reads as machinery;
 * `telarchy.com/marketplace/lookpilot` is what an owner actually posts. Slugs
 * are unique per owner, not globally, so an ambiguous slug (two public
 * workspaces, different owners, same slug) resolves to none rather than to
 * whichever the query returned first.
 */
export async function resolvePublicWorkspace(idOrSlug: string) {
  const [byId] = await db.select().from(workspaces).where(eq(workspaces.id, idOrSlug));
  if (byId) return byId;
  const bySlug = await db
    .select()
    .from(workspaces)
    .where(
      and(sql`lower(${workspaces.slug}) = lower(${idOrSlug})`, inArray(workspaces.visibility, ['public', 'unlisted'])),
    );
  return bySlug.length === 1 ? bySlug[0] : undefined;
}

/**
 * The whole floor payload for one public workspace.
 *
 * Deliberately NOT cached as a unit: beside prices it carries proposals,
 * announcements, settings, and permission-gated sections, which mutate
 * through a dozen write paths that could never all be trusted to invalidate
 * it (the first attempt at a 10s payload cache served pre-mutation ballots
 * and settings in three different test suites). The expensive parts, the
 * full price-history replays, are cached one level down with exact
 * trade/liquidity invalidation (services/predictions.ts replay bundle);
 * everything else here is a handful of indexed millisecond queries.
 */
type PublicWs = NonNullable<Awaited<ReturnType<typeof resolvePublicWorkspace>>>;

marketplaceRouter.get(
  '/:workspaceId',
  wrap(async (req, res) => {
    const ws = await resolvePublicWorkspace(req.params.workspaceId as string);
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (restrictedToMembers(ws.visibility)) {
      // A private floor is still ITS OWNER'S floor. The route is optionally
      // authed (route-policy), so a signed-in owner or member arrives with
      // req.auth; refusing them 403'd the person who had just created it
      // (owner report 2026-08-28). Everyone else keeps the 403.
      const { uid, agentId, isMasterKey } = req.auth ?? {};
      let allowed = isMasterKey === true;
      if (!allowed && (uid || agentId)) {
        if (ws.createdBy === (uid ?? agentId)) allowed = true;
        else {
          const memberships = await getAuthWorkspaceMemberships({ uid, agentId });
          allowed = memberships.some(m => m.workspaceId === ws.id);
        }
      }
      if (!allowed) {
        res.status(403).json({ error: 'This workspace is private' });
        return;
      }
    }
    res.json(await buildFloorPayload(ws));
  }),
);

export interface HomePayload {
  at: string;
  seasons: PublicSeason[];
  listings: Array<PublicListing & { floor: unknown | null }>;
}

/**
 * Build the home payload once, uncached. Floors are built in parallel; one
 * floor that throws becomes `floor: null` (logged) so a single broken
 * workspace cannot take the home page down with it. `floorOf` is injectable
 * for exactly that test.
 */
export async function buildHomePayload(
  opts: { floorOf?: (ws: PublicWs) => Promise<unknown> } = {},
): Promise<HomePayload> {
  const floorOf = opts.floorOf ?? buildFloorPayload;
  const [seasons, listings] = await Promise.all([listPublicSeasons(), listPublicWorkspaces()]);
  const ids = listings.map(l => l.workspaceId);
  const wsRows = ids.length > 0 ? await db.select().from(workspaces).where(inArray(workspaces.id, ids)) : [];
  const wsById = new Map(wsRows.map(w => [w.id, w]));
  const floors = await Promise.all(
    listings.map(async l => {
      const ws = wsById.get(l.workspaceId);
      if (!ws) return null;
      try {
        return await floorOf(ws);
      } catch (e) {
        console.error(`home payload: floor for ${l.workspaceId} failed:`, e);
        return null;
      }
    }),
  );
  return {
    at: new Date().toISOString(),
    seasons,
    listings: listings.map((l, i) => ({ ...l, floor: floors[i] })),
  };
}

/**
 * The home payload, memoized in-process for 15 seconds.
 *
 * The floor payload is deliberately not cached per workspace (see the note
 * above buildFloorPayload: permission-gated sections mutate through too many
 * write paths). This cache is different in kind: it is the ANONYMOUS view
 * only, it carries nothing a caller's identity would change, and 15 seconds
 * of staleness on a landing page is the price of a first paint with data.
 * Concurrent callers share one in-flight build; a failed build is not
 * cached, so the next caller rebuilds.
 */
const HOME_PAYLOAD_TTL_MS = 15_000;
let homeCache: { payload: HomePayload; builtAt: number } | null = null;
let homeInFlight: Promise<HomePayload> | null = null;

export async function getHomePayload(): Promise<HomePayload> {
  if (homeCache && Date.now() - homeCache.builtAt < HOME_PAYLOAD_TTL_MS) return homeCache.payload;
  if (homeInFlight) return homeInFlight;
  homeInFlight = buildHomePayload()
    .then(payload => {
      homeCache = { payload, builtAt: Date.now() };
      return payload;
    })
    .finally(() => {
      homeInFlight = null;
    });
  return homeInFlight;
}

/** Tests only: forget the memoized home payload. */
export function resetHomePayloadCache(): void {
  homeCache = null;
  homeInFlight = null;
}

async function buildFloorPayload(ws: PublicWs) {
  const workspaceId = ws.id;

  const wsMarkets = await db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false), eq(markets.active, true)));

  // One read of the workspace's metric rows serves the order tie-break, the
  // per-horizon description and the reset rule below.
  const metricRows = await db
    .select({
      id: metrics.id,
      order: metrics.order,
      description: metrics.description,
      resetsEvery: metrics.resetsEvery,
      resolvesNaUntilMeasured: metrics.resolvesNaUntilMeasured,
    })
    .from(metrics)
    .where(eq(metrics.workspaceId, workspaceId));
  const metricById = new Map(metricRows.map(r => [r.id, r]));

  // Who has traded each market, for the floor's facts row ("12 traders").
  const traderRows = await db
    .select({ marketId: trades.marketId, n: sql<number>`count(distinct ${trades.agentId})::int` })
    .from(trades)
    .where(eq(trades.workspaceId, workspaceId))
    .groupBy(trades.marketId);
  const tradersByMarket = new Map(traderRows.map(r => [r.marketId, r.n]));

  const marketList = wsMarkets
    .filter(m => !m.proposalId)
    .map(m => {
      const shares = (m.shares as [number, number]) || [0, 0];
      return {
        marketId: m.id,
        metricId: m.metricId,
        metricName: m.metricName,
        // The market's facts (docs/ui-conventions.md, "What a market says
        // about itself"): how many distinct traders, and credits traded.
        traderCount: tradersByMarket.get(m.id) ?? 0,
        tradedVolume: m.tradedVolume,
        // The headline tie-breaker and the metric stepper's order, so the
        // client computes the same primary the server did.
        metricOrder: metricById.get(m.metricId)?.order ?? null,
        targetDate: m.targetDate,
        resolvesOn: settlesOn(m),
        consensus: consensus(shares, m.liquidity, m.rangeMin, m.rangeMax) ?? null,
        probability: Math.round(pHigher(shares, m.liquidity) * 10000) / 10000,
        liquidity: m.liquidity,
        // The credits actually in the pool. `liquidity` beside it is the LMSR
        // sensitivity b = pool / ln 2 (docs/vision.md), which the price maths
        // needs and which is NOT what anyone paid in: showing b where credits
        // were meant made a 1,000-credit injection read as 1,443 in the pool
        // (owner report, 2026-08-30).
        pool: m.pool ?? 0,
        rangeMin: m.rangeMin,
        rangeMax: m.rangeMax,
      };
    });

  marketList.sort(compareSoonestFirst);

  // Everything below is what a logged-out stranger sees when they open a shared
  // workspace link. It deliberately stops short of anything a member sees:
  // metric names and market consensus are public (they already were), but
  // logged metric values, proposal text, and chat still require the `read`
  // capability, i.e. membership. Counts, not contents.
  const [owner] = [...(await getOwnerHandles([ws.createdBy])).values()];

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const proposalRows = await db
    .select({ status: proposals.status, n: sql<number>`count(*)::int` })
    .from(proposals)
    .where(
      and(eq(proposals.workspaceId, workspaceId), gte(proposals.createdAt, since), ne(proposals.status, 'removed')),
    )
    .groupBy(proposals.status);
  const proposalStats = { total: 0, approved: 0, declined: 0, declinedSpam: 0, withdrawn: 0, pending: 0 };
  for (const row of proposalRows) {
    proposalStats.total += row.n;
    if (row.status === 'approved') proposalStats.approved += row.n;
    else if (row.status === 'declined') proposalStats.declined += row.n;
    else if (row.status === 'declined_spam') proposalStats.declinedSpam += row.n;
    else if (row.status === 'withdrawn') proposalStats.withdrawn += row.n;
    else if (row.status === 'pending') proposalStats.pending += row.n;
  }

  const [metricCountRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(metrics)
    .where(eq(metrics.workspaceId, workspaceId));

  // Distinct participants across every group, so the page can say whether
  // anyone is actually here. Identities stay unlisted; this is a count only.
  const groupRows = await db
    .select({ memberIds: permissionGroups.memberIds })
    .from(permissionGroups)
    .where(eq(permissionGroups.workspaceId, workspaceId));
  const participantIds = new Set<string>();
  for (const g of groupRows) for (const id of getGroupMemberIds(g)) participantIds.add(id);

  // What a visitor gets if they press join, so the CTA can be honest about it
  // rather than promising trading rights the Public group does not hold.
  const publicGroup = groupRows.length
    ? (
        await db
          .select()
          .from(permissionGroups)
          .where(and(eq(permissionGroups.workspaceId, workspaceId), eq(permissionGroups.type, 'public')))
      )[0]
    : undefined;
  const publicCaps = (publicGroup?.capabilities as string[] | null) ?? [];

  // The ballot. When the Public group grants `read`, workspace contents are one
  // free self-join away from any visitor, so hiding proposals behind signup is
  // friction theater, not privacy. Show them: pending proposals with their
  // conditional-market deltas (the thing a visitor is being invited to price)
  // and recent decisions with their published decline reasons (the owner's
  // charter accountability on display). Workspaces whose Public group lacks
  // `read` keep the counts-only boundary.
  let openProposals: Array<Record<string, unknown>> | undefined;
  // Top contractors: the other side of the economy from traders, ranked by
  // the market's live valuation of the jobs they posted (see lib/contractors).
  let topContractors: ContractorEntry[] | undefined;
  // Trader context, same Open-workspace disclosure rule as the ballot: the
  // hero metric's logged history (what a forecaster prices against), its
  // description (the owner's provenance statement: where the number comes
  // from), and a simple activity pulse. Without these the page asks people
  // to bet on a number with no evidence, which serious forecasters refuse.
  let heroHistory: Array<{ at: Date | null; value: number }> | undefined;
  let horizonHistories:
    | Array<{
        marketId: string;
        metricName: string;
        targetDate: string;
        periodStart: string;
        periodEnd: string;
        resetsEvery: string | null;
        resolvesNaUntilMeasured: boolean;
        measured: boolean;
        description: string | null;
        points: Array<{ at: Date | null; value: number }>;
      }>
    | undefined;
  let heroMetricDescription: string | null | undefined;
  // Shipped so a manager on the floor can edit the definition in place
  // (PUT /api/metrics/:id needs the id; owner ask 2026-08-18).
  let heroMetricIdOut: string | null | undefined;
  let tradesThisWeek: number | undefined;
  let marketHistory: Array<{ at: Date; consensus: number | null }> | undefined;
  let marketHistoryMarketId: string | undefined;
  // The most recent owner disclosure, inline so the floor's first paint shows
  // it without a second request; the rest come from
  // GET /api/marketplace/:workspaceId/announcements. A trader arriving
  // mid-market should not have to go looking for the newest thing the owner
  // said (docs/vision.md, "Workspace announcements").
  let latestAnnouncement:
    | {
        id: string;
        body: string;
        publishedAt: Date;
        editedAt: Date | null;
        originalBody: string | null;
        publishedBy: string | null;
      }
    | null
    | undefined;
  let announcementCount: number | undefined;
  if (publicCaps.includes('read')) {
    const [latest] = await db
      .select()
      .from(announcements)
      .where(eq(announcements.workspaceId, workspaceId))
      .orderBy(desc(announcements.publishedAt))
      .limit(1);
    latestAnnouncement = latest
      ? {
          id: latest.id,
          body: latest.body,
          publishedAt: latest.publishedAt,
          editedAt: latest.editedAt,
          originalBody: latest.originalBody,
          publishedBy: latest.publishedBy ?? null,
        }
      : null;
    const [announcementRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(announcements)
      .where(eq(announcements.workspaceId, workspaceId));
    announcementCount = announcementRow?.n ?? 0;
    const heroMarketId = primaryMarket(marketList)?.marketId as string | undefined;
    if (heroMarketId) {
      // The series starts at the price the market OPENED at, not at its first
      // trade: an anchored pair with one trade would otherwise be a single
      // point, which a chart can only draw as a flat line and a cliff.
      const points = await marketPriceSeries(heroMarketId, workspaceId);
      marketHistory = points.slice(-500).map(pt => ({ at: pt.at, consensus: pt.consensus }));
      // Which market this replay is OF. One horizon's prices ship inline (the
      // primary, so the floor's first paint needs no second request) and the
      // rest are fetched per market. Unlabelled, the page had to guess, and it
      // guessed by position: the weekly view drew the yearly market's $77k
      // price line and dropped to the week's $213 call (owner report
      // 2026-08-17). A series that names its market cannot be misapplied.
      marketHistoryMarketId = heroMarketId;
    }
    const heroMetricId = primaryMarket(marketList)?.metricId as string | undefined;
    heroMetricIdOut = heroMetricId ?? null;
    if (heroMetricId) {
      const [metricRow] = await db
        .select({ description: metrics.description })
        .from(metrics)
        .where(and(eq(metrics.workspaceId, workspaceId), eq(metrics.id, heroMetricId)));
      heroMetricDescription = metricRow?.description ?? null;
      // Up to a year of the hero metric's real values, so the floor's
      // year chart can show the actual trajectory (not just the last few
      // days). Cadence is at most a few pushes a day, so 500 covers it.
      const logs = await db
        .select({ at: metricLogs.timestamp, value: metricLogs.value })
        .from(metricLogs)
        .where(and(eq(metricLogs.workspaceId, workspaceId), eq(metricLogs.metricId, heroMetricId)))
        .orderBy(desc(metricLogs.timestamp))
        .limit(500);
      heroHistory = logs.reverse();
    }
    // Every open horizon's own metric history, so a two-clock workspace can
    // draw one actual-vs-forecast chart per horizon instead of only the
    // soonest one's (owner direction 2026-08-15). Keyed by marketId; the
    // hero's copy stays in heroHistory for consumers that predate this.
    horizonHistories = [];
    // One row per open market, and NO cap. This was bounded to the four
    // furthest-resolving markets, which on a two-metric, three-date floor
    // (owner ask 2026-08-25) left the daily markets with no row, and a
    // horizon with no row draws no chart. The log is read once per distinct
    // metric, so the cost is per metric and the cap had nothing to protect.
    const logsByMetric = new Map<string, Array<{ at: Date | null; value: number }>>();
    for (const metricId of new Set(marketList.map(m => m.metricId as string))) {
      const rows = await db
        .select({ at: metricLogs.timestamp, value: metricLogs.value })
        .from(metricLogs)
        .where(and(eq(metricLogs.workspaceId, workspaceId), eq(metricLogs.metricId, metricId)))
        .orderBy(desc(metricLogs.timestamp))
        .limit(500);
      logsByMetric.set(metricId, rows.reverse());
    }
    for (const m of marketList) {
      const metricId = m.metricId as string;
      const rows = logsByMetric.get(metricId) ?? [];
      const metricRow = metricById.get(metricId);
      // A horizon's chart draws its metric's history, unfiltered.
      //
      // 2026-08-16: this briefly filtered points to the market's own target
      // period, to stop a weekly market that had not started drawing last
      // week's accumulation. That is wrong for a CUMULATIVE metric, whose
      // window is not its market's period: "LookPilot net 2026" accumulates
      // all year but its market targets 2026-12, so the filter dropped every
      // reading before December and both charts vanished from the floor.
      // The weekly case needs a rule about where a resetting metric's
      // current period begins, which the market's targetDate cannot answer.
      //
      // `periodStart` is the weaker, safer statement the targetDate CAN make:
      // the first moment of the period this market settles on. The chart uses
      // it to open the x-axis, never to drop a reading, so a week-long market
      // draws the whole week (owner direction 2026-08-16, "the whole week
      // should be on X axis") while a cumulative year keeps its January start,
      // whose first reading long predates its 2026-12 period.
      // A RESETTING metric's reading is about the period it was taken in and
      // nothing else, so only readings inside this market's own period are its
      // actual-so-far. Undeclared (the default, and what a cumulative metric
      // is), every reading is part of one trajectory and none is dropped.
      //
      // This is the rule the 2026-08-16 attempt got wrong by applying it to
      // every metric: "net 2026" accumulates all year under a market targeting
      // 2026-12, so filtering emptied both charts off the floor. The metric now
      // says which kind it is, rather than the chart guessing.
      const target = m.targetDate as string;
      const inPeriod = metricRow?.resetsEvery
        ? (at: Date | null) => {
            if (!at) return false;
            const t = at.getTime();
            return t >= periodStartInstant(target).getTime() && t < periodEndInstant(target).getTime();
          }
        : () => true;
      horizonHistories.push({
        marketId: m.marketId as string,
        metricName: m.metricName as string,
        targetDate: target,
        periodStart: periodStartInstant(target).toISOString(),
        // The end of the period, which is NOT the settlement instant once the
        // metric carries a reporting lag: between the two is the window where
        // the owner types the number and dates it into the period
        // (docs/guides/sources.md).
        periodEnd: periodEndInstant(target).toISOString(),
        resetsEvery: metricRow?.resetsEvery ?? null,
        // The metric's N/A declaration and whether a reading exists at all,
        // stated outright: the page must not infer "unmeasured" from an empty
        // points array, which a resetting metric ships inside a fresh period.
        resolvesNaUntilMeasured: metricRow?.resolvesNaUntilMeasured ?? false,
        measured: rows.length > 0,
        description: metricRow?.description ?? null,
        points: rows.filter(r => inPeriod(r.at)),
      });
    }
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [tradeCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(trades)
      // Activity means trades. A redemption is bookkeeping the engine did,
      // and counting its two rows would inflate the week by a factor.
      .where(and(eq(trades.workspaceId, workspaceId), gte(trades.createdAt, weekAgo), ne(trades.kind, 'redeem')));
    tradesThisWeek = tradeCount?.n ?? 0;
  }
  if (publicCaps.includes('read')) {
    // All non-withdrawn jobs (pending + decided) in one list, so the board can
    // show status inline instead of a separate history. Decided jobs keep
    // their markets (resolved/voided included, not just active) so clicking one
    // still shows the impact that was priced for it.
    const pending = await db
      .select()
      .from(proposals)
      .where(
        and(eq(proposals.workspaceId, workspaceId), inArray(proposals.status, ['pending', 'approved', 'declined'])),
      )
      .orderBy(desc(proposals.createdAt))
      .limit(40);
    const names = await getParticipantDisplayNames(pending.map(p => p.proposedBy));
    // When each proposal was last edited, so the floor can say "edited" beside
    // one whose words or price moved after people started pricing it
    // (docs/market-integrity.md, I1b). The log itself is behind
    // GET /api/proposals/:id/revisions; this is only the marker.
    const editedRows =
      pending.length > 0
        ? await db
            .select({
              proposalId: proposalRevisions.proposalId,
              at: sql<string>`max(${proposalRevisions.createdAt})`,
            })
            .from(proposalRevisions)
            .where(
              and(
                eq(proposalRevisions.workspaceId, workspaceId),
                inArray(
                  proposalRevisions.proposalId,
                  pending.map(p => p.id),
                ),
              ),
            )
            .groupBy(proposalRevisions.proposalId)
        : [];
    const editedAtById = new Map(editedRows.map(r => [r.proposalId, r.at]));

    const pendingIds = pending.map(p => p.id);
    const branchMarkets = pendingIds.length
      ? await db
          .select()
          .from(markets)
          .where(and(eq(markets.workspaceId, workspaceId), inArray(markets.proposalId, pendingIds)))
      : [];
    // Group per proposal x (metric, targetDate); the delta a visitor reads is
    // approved consensus minus declined consensus, the causal impact of saying
    // yes. tradeCount would need the trades table; presence of both branch
    // prices is enough for the public page.
    // The pair ships enough for the page to make the conditional market the
    // main view when a job is selected: not just both consensus values, but
    // the approved branch's id and price shape, so the same chart and the
    // same ticket can render and trade it.
    interface PairGroup {
      metricId: string;
      metricName: string;
      targetDate: string;
      approved: number | null;
      declined: number | null;
      approvedMarketId: string | null;
      declinedMarketId: string | null;
      approvedProbability: number | null;
      approvedLiquidity: number | null;
      declinedProbability: number | null;
      declinedLiquidity: number | null;
      // What each branch says about itself (docs/ui-conventions.md, "What a
      // market says about itself"): a conditional market is a market like any
      // other, and the floor prints these three under it exactly as it does
      // under the baseline. Per branch, because the approved world and the
      // declined world are two separate books. Null while a branch has no
      // market at all, which is not the same as a market nobody has touched.
      approvedPool: number | null;
      declinedPool: number | null;
      approvedTraders: number | null;
      declinedTraders: number | null;
      approvedVolume: number | null;
      declinedVolume: number | null;
      rangeMin: number;
      rangeMax: number;
    }
    const byProposal = new Map<string, Map<string, PairGroup>>();
    // A voided pair is dead weight on a PENDING proposal: it was voided
    // because its horizon was retired, yet it kept printing its last delta
    // on the ballot (seen 2026-08-15, when the near horizon moved to a
    // weekly cadence and every proposal still showed its old monthly
    // number). Decided proposals keep everything, voided included: their
    // markets are the record of what was priced when the owner ruled.
    // The rule itself is lib/market-pairs.ts, so the brief cannot drift from
    // the ballot again (it did, until 2026-08-31).
    const statusById = new Map(pending.map(p => [p.id, p.status as string]));
    for (const m of branchMarkets) {
      if (!m.proposalId || !m.branch) continue;
      if (!branchIsShown(statusById.get(m.proposalId) ?? 'pending', m.voided)) continue;
      const shares = (m.shares as [number, number]) || [0, 0];
      const c = consensus(shares, m.liquidity, m.rangeMin, m.rangeMax) ?? null;
      const groups = byProposal.get(m.proposalId) ?? new Map<string, PairGroup>();
      const key = `${m.metricId}|${m.targetDate}`;
      const g: PairGroup = groups.get(key) ?? {
        metricId: m.metricId,
        metricName: m.metricName,
        targetDate: m.targetDate,
        approved: null,
        declined: null,
        approvedMarketId: null,
        declinedMarketId: null,
        approvedProbability: null,
        approvedLiquidity: null,
        declinedProbability: null,
        declinedLiquidity: null,
        approvedPool: null,
        declinedPool: null,
        approvedTraders: null,
        declinedTraders: null,
        approvedVolume: null,
        declinedVolume: null,
        rangeMin: m.rangeMin,
        rangeMax: m.rangeMax,
      };
      if (m.branch === 'approved') {
        g.approved = c;
        g.approvedMarketId = m.id;
        // pHigher returns 0 (not undefined) at zero liquidity, and a fake
        // "0% probability" is worse than an honest null: the page falls
        // back to the baseline's shape for unpriced branches.
        g.approvedProbability = m.liquidity > 0 ? Math.round(pHigher(shares, m.liquidity) * 10000) / 10000 : null;
        g.approvedLiquidity = m.liquidity;
        g.approvedPool = m.pool ?? 0;
        g.approvedTraders = tradersByMarket.get(m.id) ?? 0;
        g.approvedVolume = m.tradedVolume;
        g.rangeMin = m.rangeMin;
        g.rangeMax = m.rangeMax;
      } else if (m.branch === 'declined') {
        g.declined = c;
        g.declinedMarketId = m.id;
        g.declinedProbability = m.liquidity > 0 ? Math.round(pHigher(shares, m.liquidity) * 10000) / 10000 : null;
        g.declinedLiquidity = m.liquidity;
        g.declinedPool = m.pool ?? 0;
        g.declinedTraders = tradersByMarket.get(m.id) ?? 0;
        g.declinedVolume = m.tradedVolume;
      }
      groups.set(key, g);
      byProposal.set(m.proposalId, groups);
    }

    openProposals = pending.map(p => {
      // A decided proposal prints the pair as recorded when the owner ruled
      // (proposals.decidedPricing), never its books as they read now: the
      // losing branch is voided, the winner keeps trading, an untraded book
      // can be re-anchored, and none of that is what the decision was priced
      // on (owner ruling 2026-09-04, docs/ui-conventions.md "Top
      // contractors"). The branch ids and shapes still ship so the chart can
      // draw the surviving branch's history.
      const recorded = new Map(
        (p.status === 'pending' ? [] : (p.decidedPricing ?? [])).map(d => [`${d.metricId}|${d.targetDate}`, d]),
      );
      const pairs = [...(byProposal.get(p.id)?.values() ?? [])]
        .map(g => {
          const d = recorded.get(`${g.metricId}|${g.targetDate}`);
          if (d) {
            g.approved = d.approvedConsensus;
            g.declined = d.declinedConsensus;
          }
          return g;
        })
        .map(g => ({
          // With several metrics on one date, the floor picks a proposal's
          // pair by (metric, date), never by date alone.
          metricId: g.metricId,
          metricName: g.metricName,
          targetDate: g.targetDate,
          resolvesOn: resolutionInstant(g.targetDate),
          approvedConsensus: g.approved,
          declinedConsensus: g.declined,
          delta: g.approved != null && g.declined != null ? g.approved - g.declined : null,
          approvedMarketId: g.approvedMarketId,
          declinedMarketId: g.declinedMarketId,
          approvedProbability: g.approvedProbability,
          approvedLiquidity: g.approvedLiquidity,
          declinedProbability: g.declinedProbability,
          declinedLiquidity: g.declinedLiquidity,
          approvedPool: g.approvedPool,
          declinedPool: g.declinedPool,
          approvedTraders: g.approvedTraders,
          declinedTraders: g.declinedTraders,
          approvedVolume: g.approvedVolume,
          declinedVolume: g.declinedVolume,
          rangeMin: g.rangeMin,
          rangeMax: g.rangeMax,
        }));
      // Every pair, largest impact first. This used to ship the three largest
      // of the matrix, which was all of them on a one-metric floor and half of
      // them once a floor priced two metrics on three dates, so the pair of
      // the market on screen could be missing and the board printed the
      // largest delta of some other metric instead (owner report 2026-08-26,
      // docs/ui-conventions.md "A proposal ships every pair of the grid").
      // The matrix is metrics x dates, small by construction.
      pairs.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
      return {
        id: p.id,
        // The short ordinal a person names it by (docs/ui-conventions.md,
        // "A proposal has a number and an address").
        number: p.number ?? null,
        title: p.title,
        description: p.description,
        askUsd: p.askUsd ?? null,
        status: p.status,
        resolvedAt: p.resolvedAt,
        declineReason: p.declineReason,
        proposedByName: names.get(p.proposedBy) ?? null,
        // The linkable handle for the public profile page: prefer the
        // unique nickname, fall back to the raw participant id, which the
        // profile endpoint also resolves (owner ask 2026-08-11).
        proposedByHandle: p.proposedBy,
        createdAt: p.createdAt,
        editedAt: editedAtById.get(p.id) ?? null,
        marketPairCount: pairs.length,
        markets: pairs,
      };
    });
    // Pending jobs lead (the live ballot), decided ones follow (most recently
    // decided first): one list, ordered by where a job is in its life.
    openProposals.sort((a, b) => {
      const rank = (s: unknown) => (s === 'pending' ? 0 : 1);
      const ra = rank(a.status),
        rb = rank(b.status);
      if (ra !== rb) return ra - rb;
      const at = new Date((a.resolvedAt as Date | null) ?? (a.createdAt as Date)).getTime();
      const bt = new Date((b.resolvedAt as Date | null) ?? (b.createdAt as Date)).getTime();
      return bt - at;
    });

    // Contractors rank on the market's CURRENT valuation of the jobs they
    // posted, not on dollars collected (owner direction 2026-08-14): a job
    // posted minutes ago counts the moment anyone prices it. Live jobs are
    // pending + approved; a declined job's forecast was about an action
    // nobody will take, so it scores nothing. Scored over every live job in
    // the workspace, not just the 40 the ballot ships.
    const liveJobs = await db
      .select({
        id: proposals.id,
        proposedBy: proposals.proposedBy,
        status: proposals.status,
        askUsd: proposals.askUsd,
        number: proposals.number,
        decidedPricing: proposals.decidedPricing,
      })
      .from(proposals)
      .where(and(eq(proposals.workspaceId, workspaceId), inArray(proposals.status, ['pending', 'approved'])));
    const liveJobIds = liveJobs.map(j => j.id);
    // Voided branch markets are kept for a DECIDED proposal and dropped for a
    // pending one, the same rule the ballot follows.
    //
    // A decided proposal is scored on proposals.decidedPricing, not on these
    // books; its markets are still read so the row can count them. A PENDING
    // proposal's voided pairs are
    // something else: a retired horizon, or a generation spawned during a
    // bug. Counting those made the contractor rail read -48 and -108.21 on
    // the Telarchy floor (owner report 2026-08-15) long after the live pairs
    // had been re-created at zero impact, because the largest-magnitude
    // horizon was a dead market nobody can trade.
    const liveJobMarkets = liveJobIds.length
      ? await db
          .select({
            proposalId: markets.proposalId,
            branch: markets.branch,
            metricId: markets.metricId,
            targetDate: markets.targetDate,
            shares: markets.shares,
            liquidity: markets.liquidity,
            rangeMin: markets.rangeMin,
            rangeMax: markets.rangeMax,
            voided: markets.voided,
          })
          .from(markets)
          .where(and(eq(markets.workspaceId, workspaceId), inArray(markets.proposalId, liveJobIds)))
      : [];
    const pendingJobIds = new Set(liveJobs.filter(j => j.status === 'pending').map(j => j.id));
    const pairsByJob = new Map<string, Map<string, ContractorJobPair>>();
    for (const m of liveJobMarkets) {
      if (!m.proposalId || !m.branch) continue;
      if (m.voided && pendingJobIds.has(m.proposalId)) continue;
      const c = consensus((m.shares as [number, number]) || [0, 0], m.liquidity, m.rangeMin, m.rangeMax) ?? null;
      const groups = pairsByJob.get(m.proposalId) ?? new Map<string, ContractorJobPair>();
      const key = `${m.metricId}|${m.targetDate}`;
      const pair: ContractorJobPair = groups.get(key) ?? {
        metricId: m.metricId,
        targetDate: m.targetDate,
        approvedConsensus: null,
        declinedConsensus: null,
      };
      if (m.branch === 'approved') pair.approvedConsensus = c;
      else if (m.branch === 'declined') pair.declinedConsensus = c;
      groups.set(key, pair);
      pairsByJob.set(m.proposalId, groups);
    }
    // The hero metric is the one the floor's chart is showing (soonest
    // resolving baseline market), so every contractor score is in one unit.
    const heroMetricId = (primaryMarket(marketList)?.metricId as string | undefined) ?? null;
    const contractorNames = await getParticipantDisplayNames(liveJobs.map(j => j.proposedBy));
    topContractors = computeContractors(
      liveJobs.map(j => ({
        proposalId: j.id,
        // The short ordinal a person names it by ("#7").
        number: j.number ?? null,
        proposedBy: j.proposedBy,
        status: j.status,
        askUsd: j.askUsd ?? null,
        pairs: [...(pairsByJob.get(j.id)?.values() ?? [])],
        // What an approved job is valued on: the pair as recorded when the
        // owner ruled, never the books afterwards (owner ruling 2026-09-04).
        decidedPairs: j.decidedPricing ?? null,
      })),
      heroMetricId,
      contractorNames,
      // Ten, matching the trader rail beside it (owner direction
      // 2026-08-17).
      10,
    );
  }

  // Platform-wide count of linked Manifold accounts, paid or not. Public on
  // purpose: a prediction market on "how many Manifold users will link their
  // account" cannot resolve on a number only the owner can see, and this
  // audience will not take it on faith. Defined once, in platform-stats.ts,
  // and it is the link rather than the payment because a link is what the
  // market asks about (docs/metrics.md, "Manifold accounts linked").
  const manifoldImportCount = await linkedManifoldCount();

  return {
    workspaceId,
    name: ws.name,
    slug: ws.slug,
    ownerId: owner?.ownerId ?? null,
    // Equal to ownerId when the owner never set a nickname. Callers should not
    // print a raw 32-char participant id as if it were a name; compare the two.
    ownerHandle: owner?.ownerHandle ?? null,
    description: ws.description,
    charter: ws.charter,
    subjectAbout: ws.subjectAbout ?? null,
    // The moment the floor's year chart marks, when the owner named one.
    telarchyStartedOn: ws.telarchyStartedOn ?? null,
    visibility: ws.visibility,
    proposalReward: ws.proposalReward,
    spamPenalty: ws.spamPenalty,
    joinAs: publicCaps.includes('trade') ? 'trader' : 'viewer',
    // What a USER signup starts with. API registrations start with
    // agentSignupCredits (default 0 since 2026-08-28) and are funded by
    // their owner's transfers, so a bot reading this page knows the stakes
    // it can actually bring.
    signupCredits: SIGNUP_CREDITS,
    agentSignupCredits: AGENT_SIGNUP_CREDITS,
    metricCount: metricCountRow?.n ?? 0,
    openMarketCount: marketList.length,
    participantCount: participantIds.size,
    manifoldImportCount,
    proposalStats,
    markets: marketList,
    ...(openProposals !== undefined
      ? {
          proposals: openProposals,
          topContractors,
          heroHistory,
          horizonHistories,
          heroMetricDescription,
          heroMetricId: heroMetricIdOut,
          tradesThisWeek,
          marketHistory,
          marketHistoryMarketId,
          latestAnnouncement,
          announcementCount,
        }
      : {}),
  };
}

/**
 * A single market's price history on a public workspace, replayed the same
 * way the hero market's is. Exists so the trading floor can make a
 * proposal's conditional market the main view (select a job, the chart and
 * the ticket switch to it) instead of growing a second, smaller market UI
 * underneath the first. Same Open-workspace disclosure rule as the ballot:
 * if the Public group cannot `read`, neither can this.
 */
marketplaceRouter.get(
  '/:workspaceId/markets/:marketId/history',
  wrap(async (req, res) => {
    const ws = await resolvePublicWorkspace(req.params.workspaceId as string);
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (restrictedToMembers(ws.visibility)) {
      res.status(403).json({ error: 'This workspace is private' });
      return;
    }

    const [publicGroup] = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.workspaceId, ws.id), eq(permissionGroups.type, 'public')));
    const publicCaps = (publicGroup?.capabilities as string[] | null) ?? [];
    if (!publicCaps.includes('read')) {
      res.status(403).json({ error: 'Not public' });
      return;
    }

    const [market] = await db
      .select({ id: markets.id })
      .from(markets)
      .where(and(eq(markets.id, req.params.marketId as string), eq(markets.workspaceId, ws.id)));
    if (!market) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }

    const points = await marketPriceSeries(market.id, ws.id);
    res.json({ history: points.slice(-500).map(pt => ({ at: pt.at, consensus: pt.consensus })) });
  }),
);

/**
 * The workspace's announcements, newest first (the owner's, and any
 * delegate's, each row saying which). Public with no account, because the point of an announcement is that anyone deciding
 * whether to trade here can check what was disclosed and when
 * (docs/vision.md, "Workspace announcements").
 *
 * Same Open-workspace disclosure rule as the ballot, the history and the
 * comments: private workspaces 403, and a workspace whose Public group cannot
 * read keeps the counts-only boundary.
 *
 * `originalBody` and `editedAt` are in the payload on purpose. An edited
 * announcement must read as edited, with the text it replaced still visible;
 * hiding either would turn a verifiable record back into the owner's word.
 */
marketplaceRouter.get(
  '/:workspaceId/announcements',
  wrap(async (req, res) => {
    const ws = await resolvePublicWorkspace(req.params.workspaceId as string);
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (restrictedToMembers(ws.visibility)) {
      res.status(403).json({ error: 'This workspace is private' });
      return;
    }

    const [publicGroup] = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.workspaceId, ws.id), eq(permissionGroups.type, 'public')));
    const publicCaps = (publicGroup?.capabilities as string[] | null) ?? [];
    if (!publicCaps.includes('read')) {
      res.status(403).json({ error: 'Not public' });
      return;
    }

    const rows = await db
      .select()
      .from(announcements)
      .where(eq(announcements.workspaceId, ws.id))
      .orderBy(desc(announcements.publishedAt))
      .limit(100);
    res.json({
      announcements: rows.map(a => ({
        id: a.id,
        body: a.body,
        publishedAt: a.publishedAt,
        editedAt: a.editedAt,
        originalBody: a.originalBody,
        publishedBy: a.publishedBy ?? null,
      })),
    });
  }),
);

/**
 * The workspace brief: one read that carries what this floor is about (owner
 * ask 2026-08-20). Identity and charter, every metric with its definition and
 * recent readings, the open markets and their current prices, every proposal
 * with the market's priced impact and its conversation, the owner's
 * announcements, and any document the owner published as a public source.
 *
 * This exists so an outside agent does not have to scrape a page to price a
 * market. `?format=md` returns the same facts as one markdown document, which
 * is what a language model reads best and what the floor's own Ask field
 * feeds to Claude; the default JSON is for code.
 *
 * Same public-payload contract as the rest of this router: private workspaces
 * 403, and a workspace whose Public group cannot read is refused rather than
 * summarised, because the brief IS the contents.
 */
/** How much of a proposal's pitch this read carries: enough to know what the
 *  work is, not the whole case for it. */
const DESCRIPTION_CHARS = 300;
/** Comfortably inside the 24,000-character cap on one assistant tool result
 *  (services/otto-tools.ts), with room for a floor that keeps growing. */
const SAFE_RESULT_CHARS = 22_000;

/**
 * The proposals, priced, small enough to read in one go.
 *
 * The brief and the floor's public payload both answer "which proposal is
 * worth approving", and both answer it inside tens of kilobytes, which is
 * more than an assistant's tool result holds: on 2026-08-31 Otto was handed
 * the ballot, got it truncated mid-list, and opened five proposals one at a
 * time to see the rest. A payload that has to be cut is not an answer, so
 * this one carries what pricing a decision needs and nothing else.
 *
 * Live horizons only by default: a settled one cannot be influenced by a
 * decision nobody has made yet, and it is the bulk of the bytes on a floor
 * that has been running a while. `?horizons=all` puts them back.
 *
 * Same public-payload contract as the brief: private workspaces 403, and a
 * workspace whose Public group cannot read is refused rather than summarised.
 */
marketplaceRouter.get(
  '/:workspaceId/contracts',
  wrap(async (req, res) => {
    const ws = await resolvePublicWorkspace(req.params.workspaceId as string);
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (restrictedToMembers(ws.visibility)) {
      res.status(403).json({ error: 'This workspace is private' });
      return;
    }

    const [publicGroup] = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.workspaceId, ws.id), eq(permissionGroups.type, 'public')));
    if (!((publicGroup?.capabilities as string[] | null) ?? []).includes('read')) {
      res.status(403).json({ error: 'Not public' });
      return;
    }

    const context = await buildWorkspaceContext(ws.id);
    if (!context) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    // The brief carries the newest 25 proposals, so on a busy floor this read
    // is showing a window. A window a reader does not know about is a silent
    // cut, which is the failure this endpoint exists to end, so it is stated.
    const [countRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(proposals)
      .where(and(eq(proposals.workspaceId, ws.id), ne(proposals.status, 'removed')));
    const contractsTotal = countRow?.n ?? 0;

    const all = req.query.horizons === 'all';
    // Enough of the pitch to know what the work IS. A title alone does not say
    // it, and a reader who cannot tell goes and opens the proposal, which is
    // the round trip this endpoint exists to remove (measured 2026-08-31: the
    // priceless first version still drew five per question).
    const gist = (text: string) =>
      text.length > DESCRIPTION_CHARS
        ? { description: `${text.slice(0, DESCRIPTION_CHARS)}...`, descriptionTruncated: true }
        : { description: text };

    const body = {
      workspaceId: context.workspaceId,
      slug: context.slug,
      name: context.name,
      horizons: all ? 'all' : 'live',
      contractsTotal,
      ...(contractsTotal > context.contracts.length ? { olderContractsOmitted: true } : {}),
      contracts: context.contracts.map(c => ({
        id: c.id,
        title: c.title,
        ...gist(c.description ?? ''),
        askUsd: c.askUsd,
        status: c.status,
        decisionOpen: c.decisionOpen,
        proposedBy: c.proposedBy,
        impact: c.impact
          .filter(i => all || !i.settled)
          .map(i => ({
            metricName: i.metricName,
            targetDate: i.targetDate,
            resolvesOn: i.resolvesOn,
            ...(i.settled ? { settled: true } : {}),
            approved: i.approved,
            declined: i.declined,
            delta: i.delta,
            baseline: i.baseline,
            approvedTrades: i.approvedTrades,
            declinedTrades: i.declinedTrades,
          })),
      })),
    };

    // The invariant: this read is never the one that gets cut. Descriptions
    // are the elastic part, so on a floor big enough to threaten the cap they
    // are what goes. The prices never go, because they are the answer.
    if (JSON.stringify(body).length > SAFE_RESULT_CHARS) {
      res.json({
        ...body,
        descriptionsOmitted: true,
        contracts: body.contracts.map(({ description, descriptionTruncated, ...rest }) => rest),
      });
      return;
    }
    res.json(body);
  }),
);

marketplaceRouter.get(
  '/:workspaceId/context',
  wrap(async (req, res) => {
    const ws = await resolvePublicWorkspace(req.params.workspaceId as string);
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (restrictedToMembers(ws.visibility)) {
      res.status(403).json({ error: 'This workspace is private' });
      return;
    }

    const [publicGroup] = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.workspaceId, ws.id), eq(permissionGroups.type, 'public')));
    const publicCaps = (publicGroup?.capabilities as string[] | null) ?? [];
    if (!publicCaps.includes('read')) {
      res.status(403).json({ error: 'Not public' });
      return;
    }

    const context = await buildWorkspaceContext(ws.id);
    if (!context) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    if (req.query.format === 'md') {
      res.type('text/markdown').send(renderContextMarkdown(context));
      return;
    }
    res.json(context);
  }),
);

/**
 * Ask this floor a question in plain language (owner ask 2026-08-20: reduce
 * friction for traders). The brief above goes to Claude with the question;
 * the answer may only use what the brief contains.
 *
 * Open to anonymous visitors on purpose: not knowing what the company does is
 * exactly the state a visitor is in BEFORE they have an account, so putting
 * the answer behind signup would aim it at the people who no longer need it.
 * The cost of that decision is controlled by the per-IP limiter on the route
 * and by the model's own short-answer instruction, not by a login.
 */
marketplaceRouter.post(
  '/:workspaceId/ask',
  wrap(async (req, res) => {
    if (!askEnabled()) {
      res.status(503).json({ error: 'Answers are not configured on this instance.' });
      return;
    }
    const ws = await resolvePublicWorkspace(req.params.workspaceId as string);
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (restrictedToMembers(ws.visibility)) {
      res.status(403).json({ error: 'This workspace is private' });
      return;
    }

    const [publicGroup] = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.workspaceId, ws.id), eq(permissionGroups.type, 'public')));
    const publicCaps = (publicGroup?.capabilities as string[] | null) ?? [];
    if (!publicCaps.includes('read')) {
      res.status(403).json({ error: 'Not public' });
      return;
    }

    // A conversation, not a lookup (owner direction 2026-08-20): the caller
    // keeps the turns and sends them back, which is what lets a follow-up mean
    // anything. `question` still works on its own, because an API caller asking
    // one thing should not have to build an array.
    const raw = Array.isArray(req.body?.messages)
      ? req.body.messages
      : typeof req.body?.question === 'string'
        ? [{ role: 'user', content: req.body.question }]
        : [];

    const turns: AskTurn[] = [];
    for (const m of raw.slice(-12)) {
      const role = m?.role === 'assistant' ? 'assistant' : 'user';
      const content = typeof m?.content === 'string' ? m.content.trim() : '';
      if (!content) continue;
      if (role === 'user' && content.length > 500) {
        res.status(400).json({ error: 'Keep each message under 500 characters.' });
        return;
      }
      // An assistant turn is one Otto wrote, so it is bounded by his own
      // max_tokens; anything longer than that did not come from here.
      turns.push({ role, content: content.slice(0, 4000) });
    }
    if (turns.length === 0 || turns[turns.length - 1].role !== 'user') {
      res.status(400).json({ error: 'question is required' });
      return;
    }
    const question = turns[turns.length - 1].content;

    const context = await buildWorkspaceContext(ws.id);
    if (!context) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    // Who asked, best effort. Most askers are anonymous by design, since the
    // field exists for the visitor who has not signed up yet, so the request-log
    // fields (the same pair page_visits keeps, under the same privacy policy)
    // are the only identity there is for them.
    const askedBy = req.auth?.agentId ?? null;
    const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    const ip = (fwd || req.socket.remoteAddress || '').slice(0, 60) || null;
    let country: string | null = null;
    try {
      const geoip = (await import('geoip-lite')).default;
      country = ip ? geoip.lookup(ip)?.country || null : null;
    } catch (e) {
      console.error('geoip lookup failed:', e);
    }

    const logRow = {
      id: randomUUID(),
      workspaceId: ws.id,
      question,
      askedBy,
      ip,
      country,
      model: process.env.ASK_MODEL || 'openai/gpt-5.6-luna',
      createdAt: new Date(),
    };

    // What Otto did while answering, filled in by the tools as he goes.
    const actions: ApiCallRecord[] = [];

    try {
      // Otto gets an INDEX of the floor as fixed context, not its brief: the
      // priced impact of every proposal, handed over unasked, is what he
      // answers from instead of looking (docs/vision.md, "The workspace
      // brief"). What he gets instead is doors he opens himself: Telarchy's
      // data room, the web, the API catalog, and the API itself,
      // called with THIS caller's credentials (owner direction 2026-08-21:
      // "exact same access the given user has"). Nothing here grants him
      // anything: the request he makes is the visitor's own request replayed, so
      // an anonymous asker's Otto can read and cannot act, and a signed-in
      // asker's Otto can do what they can do and no more.
      const { answer, usage } = await askAboutWorkspace(renderContextIndex(context), turns, [
        dataRoomTool(),
        // The web, on the same terms as the operator door has had since
        // 2026-08-24. It matters more here, not less: a visitor's question
        // about a competitor or a claim in a proposal is exactly the question
        // no brief can hold, and the alternative to a lookup is a guess.
        // Results arrive fenced, and the prompt forbids anything inside the
        // fence from causing a call, because on this surface Otto is holding
        // the visitor's own credentials.
        webSearchTool(actions),
        ...ottoApiTools(req, actions, ws.id),
      ]);
      console.log(
        `ask ${ws.slug ?? ws.id}: ${usage.input} in (${usage.cachedInput} cached), ${usage.output} out, $${usage.costUsd ?? '?'}`,
      );
      // Every question is kept, with its answer (owner ask 2026-08-20): a row
      // here is a gap in the floor said in a visitor's own words, and the answer
      // has to be stored beside it because a model that has since changed cannot
      // reproduce what it said today.
      if (actions.length) {
        console.log(
          `ask ${ws.slug ?? ws.id}: acted ${actions.map(a => `${a.method} ${a.path} -> ${a.status}`).join(', ')}`,
        );
      }
      await db
        .insert(floorQuestions)
        .values({ ...logRow, answer, costUsd: usage.costUsd, toolCalls: actions.length ? actions : null })
        .catch(e => console.error('question log failed:', e));
      res.json({ answer });
    } catch (e) {
      console.error('ask failed:', e);
      const message = e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500);
      // A question nobody could answer is the most interesting row in the
      // table, so a failure is logged as loudly as a success.
      await db
        .insert(floorQuestions)
        .values({ ...logRow, error: message, toolCalls: actions.length ? actions : null })
        .catch(err => console.error('question log failed:', err));
      res.status(502).json({ error: 'Could not answer that right now. Try again in a moment.' });
    }
  }),
);

/**
 * Comments, publicly readable on the floor (owner ask 2026-08-11): the
 * conversation under the market and under each job is part of what a
 * visitor sizes up before signing up, so reading it must not require an
 * account. Same Open-workspace disclosure rule as the ballot and the
 * history: if the Public group cannot read, neither can this. Posting
 * stays on the authenticated routes (markets/:id/messages,
 * proposals/:id/messages).
 */
marketplaceRouter.get(
  '/:workspaceId/comments',
  wrap(async (req, res) => {
    const ws = await resolvePublicWorkspace(req.params.workspaceId as string);
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (restrictedToMembers(ws.visibility)) {
      res.status(403).json({ error: 'This workspace is private' });
      return;
    }

    const [publicGroup] = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.workspaceId, ws.id), eq(permissionGroups.type, 'public')));
    const publicCaps = (publicGroup?.capabilities as string[] | null) ?? [];
    if (!publicCaps.includes('read')) {
      res.status(403).json({ error: 'Not public' });
      return;
    }

    const marketId = typeof req.query.marketId === 'string' ? req.query.marketId : null;
    const proposalId = typeof req.query.proposalId === 'string' ? req.query.proposalId : null;
    if (!marketId && !proposalId) {
      res.status(400).json({ error: 'Pass marketId or proposalId' });
      return;
    }

    let rows: Array<{ id: string; from: string; content: string; createdAt: Date }>;
    if (proposalId) {
      rows = await db
        .select()
        .from(proposalMessages)
        .where(and(eq(proposalMessages.workspaceId, ws.id), eq(proposalMessages.proposalId, proposalId)))
        .orderBy(asc(proposalMessages.createdAt));
    } else {
      rows = await db
        .select()
        .from(marketMessages)
        .where(and(eq(marketMessages.workspaceId, ws.id), eq(marketMessages.marketId, marketId!)))
        .orderBy(asc(marketMessages.createdAt));
    }
    const names = await getParticipantDisplayNames(rows.map(m => m.from));
    res.json(
      rows.slice(-200).map(m => ({
        id: m.id,
        fromName: names.get(m.from) ?? 'anonymous',
        content: m.content,
        createdAt: m.createdAt,
      })),
    );
  }),
);

/**
 * Who holds what, and the trade history, for a market on a public floor
 * (owner ask 2026-08-11: a way to view positions and trades for the
 * market, right beside the comments). Public read on Open workspaces,
 * same disclosure rule as comments; identities are the same public
 * handles the leaderboard shows. Marks each holder's position to the
 * market's current consensus so the worth reads live.
 */
marketplaceRouter.get(
  '/:workspaceId/market-activity',
  wrap(async (req, res) => {
    const ws = await resolvePublicWorkspace(req.params.workspaceId as string);
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (restrictedToMembers(ws.visibility)) {
      res.status(403).json({ error: 'This workspace is private' });
      return;
    }

    const [publicGroup] = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.workspaceId, ws.id), eq(permissionGroups.type, 'public')));
    const publicCaps = (publicGroup?.capabilities as string[] | null) ?? [];
    if (!publicCaps.includes('read')) {
      res.status(403).json({ error: 'Not public' });
      return;
    }

    const marketId = typeof req.query.marketId === 'string' ? req.query.marketId : null;
    if (!marketId) {
      res.status(400).json({ error: 'Pass marketId' });
      return;
    }

    const [market] = await db
      .select()
      .from(markets)
      .where(and(eq(markets.id, marketId), eq(markets.workspaceId, ws.id)));
    if (!market) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }

    const c = consensus(
      (market.shares as [number, number]) || [0, 0],
      market.liquidity,
      market.rangeMin,
      market.rangeMax,
    );
    const p =
      c === undefined ? null : Math.max(0, Math.min(1, (c - market.rangeMin) / (market.rangeMax - market.rangeMin)));

    const posRows = await db
      .select({
        agentId: positions.agentId,
        direction: positions.direction,
        shares: positions.shares,
        totalCost: positions.totalCost,
      })
      .from(positions)
      .where(and(eq(positions.workspaceId, ws.id), eq(positions.marketId, marketId), gt(positions.shares, 0)))
      .orderBy(desc(positions.shares))
      .limit(50);

    // Trades only. A redemption's ledger rows are not trades against this
    // market: nothing was bought from anyone and the price did not move, so a
    // tape that listed them would show sells the participant never placed
    // (docs/ui-conventions.md, "A redemption is not a trade").
    const tradeRows = await db
      .select({
        id: trades.id,
        agentId: trades.agentId,
        direction: trades.direction,
        shares: trades.shares,
        cost: trades.cost,
        createdAt: trades.createdAt,
      })
      .from(trades)
      .where(and(eq(trades.workspaceId, ws.id), eq(trades.marketId, marketId), ne(trades.kind, 'redeem')))
      .orderBy(desc(trades.createdAt))
      .limit(50);

    // The other half of every price in that list (owner ask 2026-08-31): a
    // price that barely moved because the book got four times deeper is not
    // the same event as a price nobody traded, and with only trades on screen
    // a reader cannot tell those apart. The rows already existed; nothing here
    // is new information, it is information that was not being shown.
    const poolRows = await db
      .select({
        id: liquidityEvents.id,
        agentId: liquidityEvents.agentId,
        amount: liquidityEvents.amount,
        poolContribution: liquidityEvents.poolContribution,
        totalLiquidity: liquidityEvents.totalLiquidity,
        type: liquidityEvents.type,
        createdAt: liquidityEvents.createdAt,
      })
      .from(liquidityEvents)
      .where(and(eq(liquidityEvents.workspaceId, ws.id), eq(liquidityEvents.marketId, marketId)))
      .orderBy(desc(liquidityEvents.createdAt))
      .limit(50);

    const ids = [
      ...new Set([
        ...posRows.map(r => r.agentId),
        ...tradeRows.map(r => r.agentId),
        ...(poolRows.map(r => r.agentId).filter(Boolean) as string[]),
      ]),
    ];
    const names = await getParticipantDisplayNames(ids);
    const handle = (id: string) => names.get(id) ?? id;

    res.json({
      consensus: c ?? null,
      positions: posRows.map(r => ({
        handle: handle(r.agentId),
        id: r.agentId,
        direction: r.direction,
        shares: r.shares,
        cost: r.totalCost,
        // Worth = shares marked to current price (the EV payout factor).
        worth: p === null ? null : Math.round(r.shares * (r.direction === 'higher' ? p : 1 - p) * 100) / 100,
      })),
      trades: tradeRows.map(r => ({
        id: r.id,
        handle: handle(r.agentId),
        direction: r.direction,
        // A negative cost is a sell (proceeds); the sign carries the kind.
        kind: r.cost < 0 ? 'sell' : 'buy',
        shares: Math.abs(r.shares),
        cost: Math.abs(r.cost),
        createdAt: r.createdAt,
      })),
      pool: poolRows
        // An event that moved nothing is not an event: the reconcile writes a
        // zero row when a market opens unfunded, and "opened it with 0" on the
        // page is noise standing where the reason should be.
        .filter(r => (r.poolContribution ?? r.amount) > 0)
        .map(r => ({
          id: r.id,
          // Null on the platform's own initial liquidity, which has no funder.
          handle: r.agentId ? handle(r.agentId) : null,
          kind: r.type === 'initial' ? 'opened' : 'deepened',
          // What the funder put in, which is the number they were charged.
          amount: r.poolContribution ?? r.amount,
          // The credits in the pool after it, which is what the row is about.
          pool: Math.round((r.totalLiquidity ?? 0) * Math.LN2 * 100) / 100,
          createdAt: r.createdAt,
        })),
    });
  }),
);

/**
 * The workspace's og:image (owner direction 2026-08-10: graphics over
 * text in the unfurl). One picture of the floor: the hero market's live
 * consensus huge, its step-line history, the resolution date. Discovery
 * data only (market consensus is already public on this page), so no
 * `read` gate; five-minute cache keeps scraper storms off the replay.
 */
marketplaceRouter.get(
  '/:workspaceId/card.png',
  wrap(async (req, res) => {
    const ws = await resolvePublicWorkspace(req.params.workspaceId as string);
    if (!ws || restrictedToMembers(ws.visibility)) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const wsMarkets = await db
      .select()
      .from(markets)
      .where(and(eq(markets.workspaceId, ws.id), eq(markets.resolved, false), eq(markets.active, true)));
    const cardOrders = await metricOrdersOf([ws.id]);
    const baseline = wsMarkets
      .filter(m => !m.proposalId)
      .map(m => ({ ...m, marketId: m.id, metricOrder: cardOrders.get(m.metricId) ?? null }));
    baseline.sort(compareSoonestFirst);
    const hero = primaryMarket(baseline);

    let history: number[] = [];
    let heroConsensus: number | null = null;
    let metricLabel = ws.name;
    let unit = '';
    let resolvesOn: string | null = null;
    if (hero) {
      const shares = (hero.shares as [number, number]) || [0, 0];
      heroConsensus = consensus(shares, hero.liquidity, hero.rangeMin, hero.rangeMax) ?? null;
      metricLabel = hero.metricName.replace(/\s*\(.*\)\s*$/, '');
      // Same mapping the floor's currencyOf uses: the "(USD)" tail becomes
      // the $ prefix; any other tail stays off the headline number.
      const unitTail = hero.metricName.match(/\(([^)]*)\)\s*$/)?.[1] ?? '';
      unit = /\busd\b|\$/i.test(unitTail) ? '$' : '';
      resolvesOn = resolutionInstant(hero.targetDate)
        ? new Date(periodEndInstant(hero.targetDate).getTime() - 1).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          })
        : null;
      const points = await marketPriceSeries(hero.id, ws.id);
      history = points
        .map(pt => pt.consensus)
        .filter((c): c is number => c !== null)
        .slice(-120);
    }

    const { renderShareCardPng } = await import('../lib/share-card');
    const png = renderShareCardPng({
      name: ws.name,
      metricLabel,
      unit,
      consensus: heroConsensus,
      resolvesOn,
      history,
    });
    // Short cache so a shared card stays close to the live price (owner ask
    // 2026-08-11: the shared link should show the current price). The big
    // number already renders the current consensus; this keeps re-fetches
    // fresh. Platforms cache og:images on their own side too, which we
    // cannot control.
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.type('png').send(png);
  }),
);

marketplaceRouter.post(
  '/:workspaceId/join',
  authMiddleware,
  requireIdentity,
  wrap(async (req, res) => {
    const { uid, agentId } = req.auth!;
    const { workspaceId } = req.params as { workspaceId: string };
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    // Visibility is the access boundary, not knowledge of the UUID. A private
    // workspace is populated by an admin adding members; nobody self-joins it.
    // 404 rather than 403 so this cannot be used to probe for private IDs.
    if (restrictedToMembers(ws.visibility)) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    await ensureSystemGroups(workspaceId);
    const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, workspaceId));
    const publicGroup = groups.find(group => group.type === 'public');
    if (!publicGroup) {
      res.status(500).json({ error: 'Workspace public group is missing' });
      return;
    }

    const participantId = agentId ?? uid;
    if (!participantId) {
      res.status(400).json({ error: 'No participant identity' });
      return;
    }

    const publicMemberIds = getGroupMemberIds(publicGroup);
    const alreadyMember = publicMemberIds.includes(participantId);

    if (!alreadyMember) {
      await db
        .update(permissionGroups)
        .set({ memberIds: [...publicMemberIds, participantId] })
        .where(and(eq(permissionGroups.id, publicGroup.id), eq(permissionGroups.workspaceId, workspaceId)));
    }

    const publicCaps = (publicGroup.capabilities as string[] | null) ?? [];
    const role = publicCaps.includes('trade') ? 'trader' : 'viewer';

    res.status(alreadyMember ? 200 : 201).json({
      ok: true,
      workspaceId,
      workspaceName: ws.name,
      role,
      alreadyMember,
    });
  }),
);
