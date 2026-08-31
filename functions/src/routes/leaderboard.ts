import { and, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { agents, authUser, prizeSeasons, seasonEntries, systemConfig, workspaces } from '../db/schema';
import { loadBoard, loadSeasonMarked, loadSeasonSettled } from '../lib/board';
import {
  getParticipantDisplayNames,
  payoutHandlesById,
  platformOperatedIds,
  publicWorkspaceOperatorIds,
} from '../lib/participants';
import {
  type LadderRung,
  type SeasonPayoutMode,
  seasonScore,
  settledScoringActive,
  settleSeason,
} from '../lib/seasons';
import { ttlCache } from '../lib/ttl-cache';
import { wrap } from '../lib/wrap';

/**
 * Participant leaderboard. Public (no auth). Aggregates only over markets in
 * public-visibility workspaces, matching the privacy contract of
 * /api/marketplace: anything inside a private workspace stays inside.
 *
 * Cross-workspace by default; pass ?workspaceId=<id or slug> to rank within
 * one public workspace, which is what a workspace's own floor shows so its
 * two rails answer the same question about the same place.
 *
 * Pass ?seasonId=<id> to ask the SAME question about a prize season instead:
 * how much each entrant's marked profit GREW while that season ran. Same
 * formula, same aggregation, the same workspace set (every workspace public
 * at read time) and a baseline subtracted. It is one endpoint on purpose: a season standing
 * and a leaderboard row that disagree about the same participant's profit on
 * the same day is the bug class that hit the floor five times in one week.
 *
 * Ranking (owner direction 2026-08-11, revised 2026-08-14 by Viktor): by
 * TRADING PROFIT MARKED TO MARKET, measured off the trades themselves
 * rather than off the balance:
 *
 *   profit = payouts on resolved markets
 *          + current worth of open positions (shares x live consensus factor)
 *          - net cash paid for those positions (buys positive, sells negative)
 *
 * An unresolved position counts as soon as its price moves; nothing waits
 * for resolution, which is the whole point of the board.
 *
 * Each all-time row also carries the split of that number, settledEarnings
 * (final: resolutions and refunds) and openEarnings (still a mark), summing
 * to totalEarnings exactly (owner direction 2026-08-24, docs/seasons.md "The
 * score"). Reported, never ranked on.
 *
 * Why not balance-minus-grant (the 2026-08-11 formula): a balance carries
 * everything the platform ever handed an account, so house accounts had to
 * be excluded by name to stop operator credits topping the board, and that
 * exclusion silently deleted the floor's most active traders (owner report
 * 2026-08-14: "maybe the bug is that it doesn't count admin into traders").
 * Trading profit is grant-blind: it only counts money that went into and
 * came out of markets, so the owner and the market maker can be ranked on
 * the same number as everyone else and nobody needs excluding.
 *
 * Everyone who has ever traded in a public workspace is on the board. The
 * aggregation itself, and the reasons it must stay in SQL, now live in
 * `lib/board.ts`; this route only decides WHICH workspaces to ask about and
 * how to dress the answer up for a reader.
 *
 * Calibration and accuracy (lib/leaderboard.ts) are reported per row but
 * are not the ranking key.
 */
export const leaderboardRouter = Router();

/**
 * The board query is five SQL aggregates over a 348k-row trades table, it has
 * no auth, and it is what the public floor rail and any prize announcement
 * point at. Uncached, a burst of arrivals is a burst of full aggregations on
 * the endpoint that has already been OOM-killed into 503s once.
 *
 * FIVE seconds, not thirty (owner report 2026-08-21: "the leaderboard seems
 * kinda laggy... and kinda twitchy"). The floor polls every fifteen seconds,
 * so a thirty-second cache made successive polls alternate between a fresh
 * answer and a stale one: the board updated, then appeared to jump back.
 * Five seconds sits under every poll interval, so each poll reads a board no
 * older than the last one it saw, while an arrival burst still collapses to
 * one aggregation per key. The trade route also calls clearBoardCache() the
 * moment a trade commits, so the trader who just moved a price is never told
 * the price did not move. Keyed by the exact workspace set so a scoped board
 * and the global board never read each other's answer.
 *
 * SETTLEMENT MUST NOT READ THIS. Assigning money runs against one fixed
 * timestamp inside a transaction (see routes/seasons.ts); a cached read is
 * fine for display and wrong for deciding who gets paid.
 */
const boardCache = ttlCache({
  ttlMs: 5_000,
  // One entry per distinct workspace set ever asked for: small today, grows
  // with scoped boards, hence the (default) size bound in the helper.
  keyOf: (workspaceIds: string[]) => [...workspaceIds].sort().join(','),
  load: (workspaceIds: string[]) => loadBoard(workspaceIds),
});

const cachedBoard = (workspaceIds: string[]) => boardCache.get(workspaceIds);

/** Settlement, the trade route, and any test that just wrote trades needs the
 *  next read to see them rather than a cached answer. */
export function clearBoardCache(): void {
  boardCache.clear();
  settledCache.clear();
  markedCache.clear();
}

/**
 * The settled-window season score (rules amended 2026-08-28; lib/board.ts
 * loadSeasonSettled), briefly cached beside the board cache: the standings
 * poll every few seconds and the settled score only moves when a market
 * resolves. Settlement never reads this cache; it computes its own final
 * (routes/seasons.ts).
 */
const settledCache = ttlCache({
  ttlMs: 5_000,
  keyOf: (seasonId: string, _workspaceIds: string[], _from: Date, _to: Date) => seasonId,
  load: (_seasonId: string, workspaceIds: string[], from: Date, to: Date) => loadSeasonSettled(workspaceIds, from, to),
});

/**
 * The same window with the mark added (lib/board.ts loadSeasonMarked): the
 * standings' display column, cached beside the score it sits next to. This
 * one moves whenever a price moves, not only on resolutions, so the same
 * five seconds the board cache uses is the right TTL for it.
 */
const markedCache = ttlCache({
  ttlMs: 5_000,
  keyOf: (seasonId: string, _workspaceIds: string[], _from: Date, _to: Date) => seasonId,
  load: (_seasonId: string, workspaceIds: string[], from: Date, to: Date) => loadSeasonMarked(workspaceIds, from, to),
});

/** The mark reads to the season's END, not to now: a market resolving next
 *  week still pays inside this season, and the whole question the column
 *  answers is what the entrant would have if every one of those markets
 *  settled at the value it is predicting now. */
function cachedSeasonMarked(
  seasonId: string,
  workspaceIds: string[],
  startsAt: Date,
  endsAt: Date,
): Promise<Map<string, number>> {
  return markedCache.get(seasonId, workspaceIds, startsAt, endsAt);
}

/** The season's settled-scoring window as standings read it live: from the
 *  start instant to now, capped at the end instant (a resolution after the
 *  end can never count, however late the season settles). */
function cachedSeasonSettled(
  seasonId: string,
  workspaceIds: string[],
  startsAt: Date,
  endsAt: Date,
): Promise<Map<string, number>> {
  const to = new Date(Math.min(Date.now(), endsAt.getTime()));
  return settledCache.get(seasonId, workspaceIds, startsAt, to);
}

/** Nickname, avatar and Manifold handle for a set of agents. Pure presentation;
 *  the board itself knows nothing about names. */
async function decorate(agentIds: string[]) {
  const displayNames = await getParticipantDisplayNames(agentIds);

  const agentRows = await db
    .select({ id: agents.id, authUserId: agents.authUserId })
    .from(agents)
    .where(inArray(agents.id, agentIds));
  const uidByAgent = new Map(agentRows.map(r => [r.id, r.authUserId]));

  const manifoldRows = await db
    .select({ key: systemConfig.key, value: systemConfig.value })
    .from(systemConfig)
    .where(
      inArray(
        systemConfig.key,
        agentIds.map(id => `manifold-claimed:agent:${id}`),
      ),
    );
  const manifoldNameByAgent = new Map<string, string>();
  for (const r of manifoldRows) {
    const agentId = r.key.replace('manifold-claimed:agent:', '');
    const v = r.value as { username?: string } | undefined;
    if (v?.username) manifoldNameByAgent.set(agentId, v.username);
  }

  const uids = agentRows.map(r => r.authUserId).filter((u): u is string => !!u);
  const imageByUid = new Map<string, string | null>();
  if (uids.length > 0) {
    const userRows = await db
      .select({ id: authUser.id, image: authUser.image })
      .from(authUser)
      .where(inArray(authUser.id, uids));
    for (const u of userRows) imageByUid.set(u.id, u.image);
  }

  return (id: string) => ({
    nickname: displayNames.get(id) ?? null,
    image: (() => {
      const uid = uidByAgent.get(id);
      return uid ? (imageByUid.get(uid) ?? null) : null;
    })(),
    manifoldUsername: manifoldNameByAgent.get(id) ?? null,
  });
}

leaderboardRouter.get(
  '/',
  wrap(async (req, res) => {
    const limit = (() => {
      const raw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
      if (!Number.isFinite(raw) || raw <= 0) return 100;
      return Math.min(raw, 500);
    })();

    const seasonId = typeof req.query.seasonId === 'string' ? req.query.seasonId.trim() : '';
    if (seasonId) {
      await seasonStandings(seasonId, limit, res);
      return;
    }

    // Optional scope: one public workspace, by id or slug. The floor's own
    // rail asks for this (owner report 2026-08-15: "why are the contractors
    // per workspace and traders globally sorted? it should all be per
    // workspace"), while /leaderboard keeps asking for the cross-workspace
    // board. Same formula either way, only the set of markets changes.
    const scope =
      typeof req.query.workspaceId === 'string'
        ? req.query.workspaceId.trim()
        : typeof req.query.workspace === 'string'
          ? req.query.workspace.trim()
          : '';

    const publicWs = await db
      .select({ id: workspaces.id, slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.visibility, 'public'));
    const scoped = scope
      ? publicWs.filter(w => w.id === scope || (w.slug ?? '').toLowerCase() === scope.toLowerCase())
      : publicWs;
    // A scope that names nothing public answers empty rather than silently
    // widening to every workspace, which would leak the opposite of what was
    // asked for.
    if (scoped.length === 0) {
      res.json({ participants: [] });
      return;
    }

    const board = await cachedBoard(scoped.map(w => w.id));
    if (board.agentIds.length === 0) {
      res.json({ participants: [] });
      return;
    }

    const dress = await decorate(board.agentIds);

    const ranked = board.agentIds.map(id => {
      const activity = board.activityById.get(id);
      const quality = board.calibrationById.get(id);
      return {
        rank: 0,
        id,
        ...dress(id),
        calibration: quality?.calibration ?? null,
        accuracy: quality?.accuracy ?? null,
        totalEarnings: board.profitById.get(id) ?? 0,
        settledEarnings: board.breakdownById.get(id)?.settled ?? 0,
        openEarnings: board.breakdownById.get(id)?.open ?? 0,
        resolvedMarkets: quality?.resolvedMarkets ?? 0,
        totalTrades: activity?.totalTrades ?? 0,
        lastTradeAt: activity?.lastTradeAt ?? null,
      };
    });
    // Profit first, most recent trade as the tiebreak; then rank + cap.
    ranked.sort((a, b) => {
      if (b.totalEarnings !== a.totalEarnings) return b.totalEarnings - a.totalEarnings;
      const at = a.lastTradeAt ? Date.parse(a.lastTradeAt) : 0;
      const bt = b.lastTradeAt ? Date.parse(b.lastTradeAt) : 0;
      return bt - at;
    });
    const capped = ranked.slice(0, limit).map((e, i) => ({ ...e, rank: i + 1 }));

    // Who is in the prize season, and what they would win if it settled now.
    // On the all-time board this is the answer to "is any of this worth money to
    // me", which the board otherwise cannot say: its own order is lifetime
    // profit, and the prize depends on SEASON score, a different number.
    const seasonInfo = await currentSeasonPrizes();

    res.json({
      participants: capped.map(e => ({
        ...e,
        seasonEntered: seasonInfo.entered.has(e.id),
        // Null rather than 0 before a season starts: no baselines exist, so
        // there is no projection to make and a 0 would read as "wins nothing"
        // rather than "not decided yet".
        seasonPrizeUsd: seasonInfo.live ? (seasonInfo.prizeById.get(e.id) ?? 0) : null,
      })),
      season: seasonInfo.meta,
    });
  }),
);

/**
 * The prize season as the all-time board needs it: who has entered, and what
 * each of them would currently win.
 *
 * Reuses the standings maths rather than reimplementing it, and returns empty
 * when there is no season, so the board is unchanged the rest of the time.
 */
async function currentSeasonPrizes(): Promise<{
  entered: Set<string>;
  prizeById: Map<string, number>;
  live: boolean;
  meta: { id: string; name: string; status: string; rulesUrl: string } | null;
}> {
  const empty = { entered: new Set<string>(), prizeById: new Map<string, number>(), live: false, meta: null };
  const seasons = await db.select().from(prizeSeasons);
  const season =
    seasons.find(x => x.status === 'running') ??
    seasons
      .filter(x => x.status === 'draft')
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] ??
    null;
  if (!season) return empty;

  const entries = await db
    .select()
    .from(seasonEntries)
    .where(and(eq(seasonEntries.seasonId, season.id), eq(seasonEntries.optedIn, true)));
  const entered = new Set(entries.map(e => e.agentId));
  const meta = { id: season.id, name: season.name, status: season.status, rulesUrl: season.rulesUrl };

  // A draft has no baselines, so every score would read as lifetime profit.
  if (season.status !== 'running' || entries.length === 0) {
    return { entered, prizeById: new Map(), live: false, meta };
  }

  // The same workspace set seasonStandings and settlement score over: every
  // workspace that is public RIGHT NOW (docs/seasons.md, owner decision
  // 2026-08-21), not the set pinned at the start. Until 2026-08-25 this column
  // scored the pinned set while the standings scored the live one, so the two
  // could name different winners for the same season on the same day.
  const publicNow = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.visibility, 'public'));
  const publicIds = publicNow.map(w => w.id);

  // Since the 2026-08-28 amendment the season ranks SETTLED profit over the
  // season window; before its effective instant the previous marked-growth
  // rule applied (lib/seasons.ts settledScoringActive). The
  // prize column and seasonStandings must flip together, which they do by
  // both asking the same function.
  const settled = settledScoringActive()
    ? await cachedSeasonSettled(season.id, publicIds, new Date(season.startsAt), new Date(season.endsAt))
    : null;
  const board = settled ? null : await cachedBoard(publicIds);

  const entrantIds = entries.map(e => e.agentId);
  const house = await platformOperatedIds(entrantIds);
  const operators = await publicWorkspaceOperatorIds(entrantIds);
  const handles = await payoutHandlesById(entrantIds);
  const projection = settleSeason(
    entries.map(e => ({
      agentId: e.agentId,
      baselineProfit: settled ? 0 : e.baselineProfit,
      currentProfit: settled ? (settled.get(e.agentId) ?? 0) : (board?.profitById.get(e.agentId) ?? 0),
      enteredAt: e.enteredAt ? new Date(e.enteredAt) : new Date(0),
      platformOperated: house.has(e.agentId),
      workspaceOperator: operators.has(e.agentId),
      payoutHandle: handles.get(e.agentId) ?? null,
    })),
    (season.ladder ?? []) as LadderRung[],
    season.poolUsd,
    {
      payoutMode: (season.payoutMode ?? 'ladder') as SeasonPayoutMode,
      minPayoutUsd: season.minPayoutUsd ?? 0,
      strictEligibility: season.strictEligibility === true,
    },
  );

  return {
    entered,
    prizeById: new Map(projection.ranked.map(r => [r.agentId, r.prizeUsd])),
    live: true,
    meta,
  };
}

/**
 * Standings for one prize season.
 *
 * A RUNNING season is computed live: the board over every workspace public
 * right now, minus each entrant's baseline.
 *
 * A SETTLED season reads the stored finals and never recomputes. If it
 * recomputed, the published winner would quietly change every time a price
 * moved after settlement, including after the money had been sent.
 *
 * Only opted-in entrants appear. A baseline row exists for every participant
 * who had traded when the season started (that is what makes late opt-in
 * harmless), and those rows are not entries.
 */
async function seasonStandings(seasonId: string, limit: number, res: import('express').Response) {
  const [season] = await db.select().from(prizeSeasons).where(eq(prizeSeasons.id, seasonId)).limit(1);
  // 404 rather than falling through to the global board: a typo'd season id
  // silently answering with all-time profit would be read as season standings.
  if (!season) {
    res.status(404).json({ error: 'Season not found' });
    return;
  }

  const ladder = (season.ladder ?? []) as LadderRung[];
  const meta = {
    id: season.id,
    name: season.name,
    status: season.status,
    startsAt: season.startsAt,
    endsAt: season.endsAt,
    settledAt: season.settledAt,
    poolUsd: season.poolUsd,
    ladder,
    rulesUrl: season.rulesUrl,
  };

  if (season.status === 'draft') {
    // No baselines exist yet, so a score would read as the entrant's whole
    // lifetime profit. But an empty answer told the person who just opted in
    // that nobody had entered, on the page every launch link points at (owner
    // decision 2026-08-21, hours before Season 0 started). List who entered,
    // in entry order, with no score: the score genuinely does not exist yet.
    const entries = await db
      .select()
      .from(seasonEntries)
      .where(and(eq(seasonEntries.seasonId, seasonId), eq(seasonEntries.optedIn, true)));
    const dress = await decorate(entries.map(e => e.agentId));
    const rows = entries
      .sort((a, b) => {
        const at = a.enteredAt ? new Date(a.enteredAt).getTime() : 0;
        const bt = b.enteredAt ? new Date(b.enteredAt).getTime() : 0;
        if (at !== bt) return at - bt;
        return a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0;
      })
      .slice(0, limit)
      .map((e, i) => ({
        rank: i + 1,
        id: e.agentId,
        ...dress(e.agentId),
        score: null,
        // A draft has no window and no baselines, so there is nothing to
        // mark either. Null says "not decided yet" where 0 would say "worth
        // nothing".
        markedScore: null,
        markedProjectedPrizeUsd: null,
        enteredAt: e.enteredAt,
      }));
    res.json({ season: meta, participants: rows });
    return;
  }

  const entries = await db
    .select()
    .from(seasonEntries)
    .where(and(eq(seasonEntries.seasonId, seasonId), eq(seasonEntries.optedIn, true)));
  if (entries.length === 0) {
    res.json({ season: meta, participants: [] });
    return;
  }

  const dress = await decorate(entries.map(e => e.agentId));

  if (season.status === 'settled') {
    const rows = entries
      .filter(e => e.finalRank !== null)
      .sort((a, b) => (a.finalRank ?? 0) - (b.finalRank ?? 0))
      .slice(0, limit)
      .map(e => ({
        rank: e.finalRank,
        id: e.agentId,
        ...dress(e.agentId),
        score: e.finalScore ?? 0,
        // A settled season publishes what it paid and never recomputes. A
        // mark on a finished season would be a live number sitting beside a
        // frozen one, inviting the reading that the prize might still move.
        markedScore: null,
        markedProjectedPrizeUsd: null,
        prizeUsd: e.prizeUsd ?? 0,
        claimState: e.prizeUsd && e.prizeUsd > 0 ? e.claimState : null,
      }));
    res.json({ season: meta, participants: rows });
    return;
  }

  // Running: live board over every workspace that is public RIGHT NOW, not
  // the set pinned at the start (owner decision 2026-08-21: the season scores
  // over all public workspaces, including ones published mid-season; Season 0
  // is experimental and its rules say so). The pinned set stays recorded as
  // what was public at the start instant; a pinned floor that went private
  // stops contributing simply because it is no longer public, and
  // workspacesDropped still reports that.
  const pinned = (season.workspaceIds ?? []) as string[];
  const publicNow = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.visibility, 'public'));
  const publicIds = new Set(publicNow.map(w => w.id));
  const scoring = publicNow.map(w => w.id);

  // The scoring key (rules amended 2026-08-28): SETTLED profit over the
  // season window from the effective instant, the previous marked-growth
  // rule before it. Same switch as currentSeasonPrizes, so the prize column
  // on the all-time board and these standings can never disagree.
  const settled = settledScoringActive()
    ? await cachedSeasonSettled(season.id, scoring, new Date(season.startsAt), new Date(season.endsAt))
    : null;
  const board = settled ? null : await cachedBoard(scoring);
  // The display column beside the score: the same arithmetic with open
  // markets that still resolve inside the season valued at their current
  // call (docs/seasons.md, "The standings show the mark beside the score").
  // Only under settled scoring, because before it the score IS a mark and a
  // second copy of the same number would be noise.
  const marked = settled
    ? await cachedSeasonMarked(season.id, scoring, new Date(season.startsAt), new Date(season.endsAt))
    : null;
  const rows = entries.map(e => ({
    id: e.agentId,
    ...dress(e.agentId),
    score: settled
      ? (settled.get(e.agentId) ?? 0)
      : seasonScore(board?.profitById.get(e.agentId) ?? 0, e.baselineProfit),
    markedScore: marked ? (marked.get(e.agentId) ?? 0) : null,
    enteredAt: e.enteredAt,
  }));
  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const at = a.enteredAt ? new Date(a.enteredAt).getTime() : 0;
    const bt = b.enteredAt ? new Date(b.enteredAt).getTime() : 0;
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // What each entrant would win if the season settled right now, from the SAME
  // function settlement uses. Projected rather than stored, and computed here
  // rather than in the client, so the number a standing shows and the number
  // a settlement pays can never drift apart: a second copy of "who gets which
  // rung" is a promise the payout might not keep.
  const rowIds = rows.map(r => r.id);
  const house = await platformOperatedIds(rowIds);
  const operators = await publicWorkspaceOperatorIds(rowIds);
  const handles = await payoutHandlesById(rowIds);
  const projection = settleSeason(
    rows.map(r => ({
      agentId: r.id,
      baselineProfit: 0,
      // Scores are already computed above; settleSeason subtracts baseline
      // from current, so feeding score against a zero baseline reproduces it.
      currentProfit: r.score,
      enteredAt: r.enteredAt ? new Date(r.enteredAt) : new Date(0),
      platformOperated: house.has(r.id),
      workspaceOperator: operators.has(r.id),
      payoutHandle: handles.get(r.id) ?? null,
    })),
    ladder,
    season.poolUsd,
    {
      payoutMode: (season.payoutMode ?? 'ladder') as SeasonPayoutMode,
      minPayoutUsd: season.minPayoutUsd ?? 0,
      strictEligibility: season.strictEligibility === true,
    },
  );
  const projectedById = new Map(projection.ranked.map(r => [r.agentId, r.prizeUsd]));

  // What the pool would pay if the mark held to the end. The SAME settlement
  // function, run over the marked scores, for the same reason the projection
  // above uses it: a second copy of "who gets which share" is a promise the
  // payout might not keep. Eligibility, the payout mode and the minimum are
  // the season's own, so an entrant who cannot be paid reads a dash in both
  // columns rather than money in one of them.
  const markedProjection = marked
    ? settleSeason(
        rows.map(r => ({
          agentId: r.id,
          baselineProfit: 0,
          currentProfit: r.markedScore ?? 0,
          enteredAt: r.enteredAt ? new Date(r.enteredAt) : new Date(0),
          platformOperated: house.has(r.id),
          workspaceOperator: operators.has(r.id),
          payoutHandle: handles.get(r.id) ?? null,
        })),
        ladder,
        season.poolUsd,
        {
          payoutMode: (season.payoutMode ?? 'ladder') as SeasonPayoutMode,
          minPayoutUsd: season.minPayoutUsd ?? 0,
          strictEligibility: season.strictEligibility === true,
        },
      )
    : null;
  const markedPrizeById = new Map(markedProjection?.ranked.map(r => [r.agentId, r.prizeUsd]) ?? []);

  res.json({
    season: { ...meta, workspacesDropped: pinned.filter(id => !publicIds.has(id)).length },
    participants: rows.slice(0, limit).map((r, i) => ({
      ...r,
      rank: i + 1,
      projectedPrizeUsd: projectedById.get(r.id) ?? 0,
      markedProjectedPrizeUsd: marked ? (markedPrizeById.get(r.id) ?? 0) : null,
    })),
  });
}
