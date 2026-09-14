import { randomUUID } from 'crypto';
import { and, asc, desc, eq, getTableColumns, gt, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  agents,
  liquidityEvents,
  markets,
  metricLogs,
  metrics,
  positions,
  proposals,
  trades,
  updates,
} from '../db/schema';
import { afterCommit } from '../lib/after-commit';
import { consensus, pHigher, resolutionPayouts } from '../lib/amm';
import { coalesce } from '../lib/coalesce';
import { mapWithConcurrency } from '../lib/concurrency';
import { periodEndInstant, periodStartInstant, resolutionInstant } from '../lib/date-utils';
import { AppError } from '../lib/errors';
import { emitPricesChanged, onPricesChanged } from '../lib/market-events';
import { ttlCache } from '../lib/ttl-cache';
import { toUnits } from '../lib/validation';
import type { Metric } from '../types';
import { applyCredits } from './credits';
import { emitEvent } from './events';
import { distributeLPLeftover, voidMarket } from './markets';
import { getAllMetrics, metricReadingInPeriod } from './metrics';
import { notifyMarketResolved } from './notifications';
import { releaseLimitOrdersForMarket } from './trading';

type MarketRow = typeof markets.$inferSelect;

export async function resolveSingleMarket(
  marketId: string,
  workspaceId: string,
): Promise<{ resolved: boolean; totalPayout: number; skipped?: boolean }> {
  const [market] = await db
    .select()
    .from(markets)
    .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
  if (!market) return { resolved: false, totalPayout: 0, skipped: true };
  if (market.resolved) return { resolved: false, totalPayout: 0, skipped: true };

  const allMetrics = await getAllMetrics(workspaceId);
  const metricMap = new Map<string, Metric>(allMetrics.map(m => [m.id, m]));
  const result = await resolveMarketRow(market, metricMap, workspaceId);
  return { resolved: !result.skipped, totalPayout: result.totalPayout, skipped: result.skipped };
}

/** An answer known before the period ends (docs/market-integrity.md, "The
 *  answer can arrive before the period ends"): the owner's value, when it was
 *  taken, and why the book is settled now. */
export interface EarlyFixing {
  value: number;
  at: Date;
  reason: string;
}

async function resolveMarketRow(
  market: MarketRow,
  metricMap: Map<string, Metric>,
  workspaceId: string,
  early?: EarlyFixing,
): Promise<{ positions: number; totalPayout: number; skipped?: boolean }> {
  const metric = metricMap.get(market.metricId);
  if (!metric) {
    console.error(`Market ${market.id} (${market.metricName}): metric ${market.metricId} not found, skipping`);
    return { positions: 0, totalPayout: 0, skipped: true };
  }
  // Settle on the metric value as of resolvesOn (the period-end boundary),
  // not the live value at whatever moment the resolve cron happens to fire.
  // The cron drifts (observed +12s to +80min), and value-at-cron-time made
  // hour markets resolve against the previous or next hour's reading
  // depending on that race. The fixing is deterministic: updates landing
  // after the boundary count toward the next fixing, never this one.
  const boundary = periodEndInstant(market.targetDate);
  // The reading AND when it was taken: the second half is recorded on the
  // market so the settlement can say how old it was (docs/guides/sources.md).
  // An early fixing IS the reading: the owner has said the answer is known.
  const fixing = early
    ? { value: early.value, at: early.at, na: false }
    : await metricReadingInPeriod(market.metricId, periodStartInstant(market.targetDate), boundary, workspaceId);
  const rawValue = fixing?.value ?? null;

  // The owner said the number does not exist for this period (owner ask
  // 2026-09-01). That is an answer, not a gap: the market voids, every
  // position is refunded, and the reason is published, exactly as it is for a
  // metric nobody has ever read.
  if (fixing?.na) {
    const voided = await voidMarket(
      market,
      workspaceId,
      `N/A: "${market.metricName}" was reported as not existing for ${market.targetDate}, so there is nothing to settle on. Every position was refunded.`,
    );
    return { positions: voided.refunded, totalPayout: 0, skipped: true };
  }
  if (rawValue === null && metric.resolvesNaUntilMeasured) {
    // A number that does not exist yet has no fixing (owner ask 2026-08-25:
    // "if not invested.. it resolves N/A"). The market is N/A: voided, every
    // position refunded, the reason published. The default `value` of a
    // never-measured metric is 0, and "$0 valuation" is the wrong answer this
    // rule exists to prevent. docs/ui-conventions.md, "A market on a number
    // that does not exist yet resolves N/A".
    const voided = await voidMarket(
      market,
      workspaceId,
      `N/A: "${market.metricName}" had no reading by ${boundary.toISOString()}, so there is nothing to settle on. Every position was refunded.`,
    );
    return { positions: voided.refunded, totalPayout: 0, skipped: true };
  }
  if (rawValue === null) {
    // Unreachable by construction, and refusing rather than guessing.
    // A market is only due once a reading dated INSIDE its period exists
    // (marketDueness), and such a reading is by definition at-or-before the
    // boundary, so the fixing is always found. This used to fall back to the
    // metric's LIVE value, which is the "settles on a number from the wrong
    // period" shape the whole design exists to remove.
    console.error(
      `Market ${market.id} (${market.metricName}): due with no reading at-or-before ${boundary.toISOString()}; refusing to settle on a value from another period`,
    );
    return { positions: 0, totalPayout: 0, skipped: true };
  }
  if (rawValue === null || rawValue < 0) {
    console.error(`Market ${market.id} (${market.metricName}): metric value is ${rawValue}, skipping`);
    return { positions: 0, totalPayout: 0, skipped: true };
  }

  const actualValue = Math.min(rawValue, market.rangeMax);
  const [lowerPay, higherPay] = resolutionPayouts(actualValue, market.rangeMin, market.rangeMax);
  let pool = market.pool ?? 0;

  let totalPayout = 0;
  let positionCount = 0;
  let alreadySettled = false;

  await db.transaction(async tx => {
    // Claim the market before paying anything. Three schedules reach
    // settlement and no two of them exclude each other: Cloud Scheduler's
    // POST /api/cron/resolve takes no lock, the in-process timer holds
    // LOCK_KEYS.resolve, and startupCatchUp holds a DIFFERENT key for the
    // same work, on every container boot (each deploy lands a candidate at
    // --min-instances 1). Whoever loses this lock finds resolved = true and
    // returns, so a holder is paid once however many resolvers arrived
    // together (bug hunt 2026-08-31, settlement-idempotency.test.ts).
    const [claimed] = await tx
      .select({ resolved: markets.resolved, pool: markets.pool })
      .from(markets)
      .where(and(eq(markets.id, market.id), eq(markets.workspaceId, workspaceId)))
      .for('update');
    if (!claimed || claimed.resolved) {
      alreadySettled = true;
      return;
    }
    // The pool as it stands under the lock, not as it stood when the caller
    // read the row: a trade or an injection can have landed in between, and
    // the LP leftover is computed from it.
    pool = claimed.pool ?? 0;

    // Read INSIDE the claim: a position read before the lock is a snapshot
    // another resolver can already have paid out.
    const posRows = await tx
      .select()
      .from(positions)
      .where(and(eq(positions.workspaceId, workspaceId), eq(positions.marketId, market.id)));

    for (const pos of posRows) {
      if (pos.shares <= 0) continue;
      const payFactor = pos.direction === 'higher' ? higherPay : lowerPay;
      const payout = Math.round(pos.shares * payFactor * 100) / 100;
      if (payout <= 0) continue;
      totalPayout += payout;
      positionCount++;
      await applyCredits(tx, {
        agentId: pos.agentId,
        workspaceId,
        deltaUnits: toUnits(payout),
        reason: 'payout',
        refType: 'market',
        refId: market.id,
        also: { earnedBetting: sql`${agents.earnedBetting} + ${payout}` },
      });
    }

    if (totalPayout > pool + 0.01) {
      console.error(`Market ${market.id}: totalPayout ${totalPayout} exceeds pool ${pool} - LMSR invariant violated`);
    }

    // Orders resting when the answer arrives never get to fill, so their
    // reserved credits are refunded rather than resolved along with the market.
    await releaseLimitOrdersForMarket(tx, market.id, 'cancelled');

    // Cap leftover at 0 so a violated invariant can never subtract from LPs.
    const poolLeftover = Math.max(0, Math.round((pool - totalPayout) * 100) / 100);
    await tx
      .update(markets)
      .set({
        resolved: true,
        resolvedAt: new Date(),
        actualValue,
        settledReadingAt: fixing?.at ?? null,
        active: false,
        pool: 0,
      })
      .where(and(eq(markets.id, market.id), eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)));

    await distributeLPLeftover(tx, market.id, poolLeftover, workspaceId);
  });

  // A resolver that lost the claim settled nothing, so it announces nothing
  // and mails nobody: the winner already did both.
  if (alreadySettled) return { positions: 0, totalPayout: 0, skipped: true };

  emitEvent(
    'market:resolved',
    {
      marketId: market.id,
      metricName: market.metricName,
      targetDate: market.targetDate,
      actualValue,
      ...(early ? { settledEarly: true, reason: early.reason } : {}),
    },
    workspaceId,
  ).catch(e => console.error('emitEvent failed:', e));

  // Fire-and-forget, after the transaction: the settlement is the answer to
  // every bet on this book, and mail must never block or fail a resolve.
  void notifyMarketResolved({ workspaceId, marketId: market.id });

  return { positions: positionCount, totalPayout };
}

/**
 * Settle a metric early (docs/market-integrity.md, "The answer can arrive
 * before the period ends"): file the reading at `asOf` and settle every open
 * book on the metric at that value, floor books and continued proposal
 * branches alike. Voided and settled books are untouched, so a second call
 * settles nothing more. Returns the ids of the books settled by this call.
 */
export async function settleMetricEarly(
  metricId: string,
  workspaceId: string,
  opts: { value: number; reason: string; asOf?: Date },
): Promise<{ settled: string[]; totalPayout: number }> {
  const reason = (opts.reason ?? '').trim();
  if (!reason) throw new AppError('reason is required: say why the answer is known before the period ends', 400);
  const value = opts.value;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new AppError('value must be a non-negative number', 400);
  }
  const at = opts.asOf ?? new Date();
  if (Number.isNaN(at.getTime())) throw new AppError('asOf must be an ISO instant', 400);
  // The future is not a measurement (the same bound as PUT /metrics/:id).
  if (at.getTime() > Date.now() + 60_000) throw new AppError('asOf cannot be in the future', 400);

  const [metric] = await db
    .select()
    .from(metrics)
    .where(and(eq(metrics.id, metricId), eq(metrics.workspaceId, workspaceId)));
  if (!metric) throw new AppError('Metric not found', 404);

  // The reading first: the settlement below is the answer to every open
  // book, and the log is where that answer lives for the chart and for the
  // next reader. Filed the same way PUT /metrics/:id files a value.
  await db.transaction(async tx => {
    await tx.insert(metricLogs).values({
      id: randomUUID(),
      workspaceId,
      metricId,
      metricName: metric.name,
      value,
      outlook: value,
      timestamp: at,
    });
    await tx
      .update(metrics)
      .set({ value, updatedAt: new Date() })
      .where(and(eq(metrics.id, metricId), eq(metrics.workspaceId, workspaceId)));
    await tx.insert(updates).values({
      id: randomUUID(),
      workspaceId,
      metricName: metric.name,
      oldValue: metric.value ?? 0,
      newValue: value,
      description: `Settled early: ${reason}`,
      timestamp: new Date(),
    });
  });

  const open = await db
    .select()
    .from(markets)
    .where(
      and(
        eq(markets.workspaceId, workspaceId),
        eq(markets.metricId, metricId),
        eq(markets.resolved, false),
        eq(markets.voided, false),
      ),
    );
  const metricMap = new Map<string, Metric>((await getAllMetrics(workspaceId)).map(m => [m.id, m]));
  const settled: string[] = [];
  let totalPayout = 0;
  for (const market of open) {
    const r = await resolveMarketRow(market, metricMap, workspaceId, { value, at, reason });
    if (!r.skipped) {
      settled.push(market.id);
      totalPayout += r.totalPayout;
    }
  }
  emitPricesChanged(workspaceId);
  return { settled, totalPayout };
}

/**
 * Which branch of a conditional pair settles, given the proposal's status.
 * `approved` and `declined` are the two decided worlds; everything else
 * (pending, withdrawn, spam, removed) decided nothing, so no branch settles
 * and both are voided.
 */
export function conditionalBranchToSettle(
  status: string | undefined,
  /** The chosen option on an approved proposal with options: its markets
   *  are the world (docs/guides/proposals.md, "Deciding is choosing"). */
  decidedOption?: string | null,
): string | null {
  if (status === 'approved') return decidedOption || 'approved';
  if (status === 'declined') return 'declined';
  return null;
}

/** How long a market waits for its reading before giving up, when its metric
 *  declares no longer deadline of its own. A day: long enough for a daily
 *  collector or a person to file the number, short enough that credits are
 *  not held on a floor nobody is tending. */
const GIVE_UP_GRACE_MINUTES = 24 * 60;

/**
 * Is this market's answer here, and if not, has it waited long enough?
 *
 * `due` is true only when a reading dated INSIDE the market's own period
 * exists. The last reading at-or-before the period end is usually the
 * PREVIOUS period's number, and settling on that is exactly what this design
 * exists to avoid.
 *
 * `pastDeadline` is the backstop: `settlementLagMinutes` past the period end
 * with no reading, the market gives up. It is no longer a settlement delay -
 * nothing about trading or payout is timed off it - it is how long a market
 * waits for its number before voiding and handing everyone their credits
 * back. Without it an owner who stops filing freezes other people's money
 * indefinitely.
 */
async function marketDueness(
  market: { metricId: string; targetDate: string },
  workspaceId: string,
  now: Date,
): Promise<{ due: boolean; pastDeadline: boolean }> {
  const start = periodStartInstant(market.targetDate);
  const end = periodEndInstant(market.targetDate);
  if (Number.isNaN(end.getTime())) return { due: false, pastDeadline: false };
  if (now < end) return { due: false, pastDeadline: false };

  const [inPeriod] = await db
    .select({ id: metricLogs.id })
    .from(metricLogs)
    .where(
      and(
        eq(metricLogs.workspaceId, workspaceId),
        eq(metricLogs.metricId, market.metricId),
        gte(metricLogs.timestamp, start),
        lte(metricLogs.timestamp, end),
      ),
    )
    .limit(1);
  if (inPeriod) return { due: true, pastDeadline: false };

  // For a metric that declares N/A a legitimate answer, the ABSENCE of a
  // reading is itself the answer, so the market is due at its period end
  // rather than waiting the deadline out. resolveMarketRow voids it and
  // publishes the reason (owner ask 2026-08-25, docs/ui-conventions.md
  // "A market on a number that does not exist yet resolves N/A").
  const [naMetric] = await db
    .select({ na: metrics.resolvesNaUntilMeasured })
    .from(metrics)
    .where(and(eq(metrics.id, market.metricId), eq(metrics.workspaceId, workspaceId)));
  if (naMetric?.na) return { due: true, pastDeadline: false };

  const [metricRow] = await db
    .select({ lag: metrics.settlementLagMinutes })
    .from(metrics)
    .where(and(eq(metrics.id, market.metricId), eq(metrics.workspaceId, workspaceId)));
  // At LEAST the grace, whatever the metric declares. A lag of 0 is the
  // default and says "the number is knowable at period end", not "give up on
  // it the same second": readings usually arrive from a collector or a person
  // shortly afterwards, and voiding instantly would refund markets that were
  // about to settle honestly. The declared lag wins whenever it is longer.
  const lagMinutes = Math.max(metricRow?.lag ?? 0, GIVE_UP_GRACE_MINUTES);
  const deadline = new Date(end.getTime() + lagMinutes * 60_000);
  return { due: false, pastDeadline: now >= deadline };
}

/**
 * The most books one run settles or voids (docs/infra/deploy.md, "Reads are
 * bounded in the size of a workspace"). What is left is reported as
 * `remaining` and picked up by the next tick, so no run approaches Cloud
 * Run's 300 s request timeout however many books fall due at once (a floor
 * posting a proposal a minute has ~1,440 due at midnight).
 */
export const RESOLVE_BATCH_MAX = 500;
/** Fixing lookups in flight at once, against a pool of four. */
const DUENESS_CONCURRENCY = 2;

export async function resolvePredictions(
  targetDate: string | undefined,
  workspaceId: string,
): Promise<{ resolved: number; totalPayout: number; remaining: number }> {
  // Optional `targetDate` override pins "now" to that day's midnight UTC
  // (test/backfill use). A market is resolvable once its period has fully
  // passed; instant-based so hour-granularity markets resolve on the next
  // hourly cron run instead of waiting for midnight.
  const now = targetDate ? new Date(`${targetDate}T00:00:00.000Z`) : new Date();

  const openMarkets = await db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)));

  // DUE is the market's own settlement instant, which is its period end plus
  // the metric's reporting lag when it opened (owner ask 2026-08-31: a
  // September total cannot exist at midnight on the 30th). The FIXING below
  // is still the last reading at or before the PERIOD END, so the lag buys
  // time to report the number and never changes which period is priced.
  // A market is due when its READING has arrived, not when a clock says so.
  // The reading has to be dated INSIDE the market's own period: the last
  // reading at-or-before the period end is usually the PREVIOUS period's
  // number, and settling on that is the bug the whole design exists to avoid.
  //
  // A market with no in-period reading yet is left open and keeps trading,
  // because nobody has its answer. Its deadline is the metric's
  // settlementLagMinutes past the period end; past that, it voids and refunds
  // rather than locking credits forever (owner decision 2026-09-01,
  // docs/market-integrity.md, notes/resolve-on-the-reading-2026-09-01.md).
  //
  // Dueness is a property of the (metric, target date), not of the book:
  // every book on one period shares one fixing, so it is looked up once per
  // group with a bounded number in flight, never once per market in one
  // Promise.all (docs/infra/deploy.md, "Reads are bounded in the size of a
  // workspace").
  const groups = new Map<string, { metricId: string; targetDate: string; markets: typeof openMarkets }>();
  for (const m of openMarkets) {
    const key = `${m.metricId}:${m.targetDate}`;
    const g = groups.get(key);
    if (g) g.markets.push(m);
    else groups.set(key, { metricId: m.metricId, targetDate: m.targetDate, markets: [m] });
  }
  const dueness = await mapWithConcurrency([...groups.values()], DUENESS_CONCURRENCY, async g => ({
    ...g,
    ...(await marketDueness(g, workspaceId, now)),
  }));
  // Everything with work to do this run, oldest period first, capped at
  // RESOLVE_BATCH_MAX; the rest is next tick's.
  const actionable = dueness
    .filter(d => d.due || d.pastDeadline)
    .sort((a, b) => periodEndInstant(a.targetDate).getTime() - periodEndInstant(b.targetDate).getTime())
    .flatMap(d => d.markets.map(market => ({ market, due: d.due })));
  const batch = actionable.slice(0, RESOLVE_BATCH_MAX);
  const remaining = actionable.length - batch.length;
  if (remaining > 0) {
    console.log(
      `resolvePredictions [${workspaceId}]: ${actionable.length} books actionable, settling ${batch.length} this run`,
    );
  }

  let voidedForDeadline = 0;
  for (const { market, due } of batch) {
    if (due) continue;
    await voidMarket(
      market,
      workspaceId,
      `No reading for ${market.targetDate} arrived before this market's deadline, so there is nothing to settle on. Every position was refunded.`,
    );
    voidedForDeadline++;
  }
  const marketsToResolve = batch.filter(b => b.due).map(b => b.market);
  if (marketsToResolve.length === 0) return { resolved: 0, totalPayout: 0, remaining };

  const allMetrics = await getAllMetrics(workspaceId);
  const metricMap = new Map<string, Metric>(allMetrics.map(m => [m.id, m]));

  const proposalIds = [...new Set(marketsToResolve.map(m => m.proposalId).filter(Boolean) as string[])];
  const proposalStatusMap = new Map<string, { status: string; decidedOption: string | null }>();
  if (proposalIds.length > 0) {
    const proposalRows = await db
      .select({ id: proposals.id, status: proposals.status, decidedOption: proposals.decidedOption })
      .from(proposals)
      .where(and(eq(proposals.workspaceId, workspaceId), inArray(proposals.id, proposalIds)));
    for (const row of proposalRows)
      proposalStatusMap.set(row.id, { status: row.status, decidedOption: row.decidedOption ?? null });
  }

  let totalPayout = 0;
  let resolvedCount = 0;
  let processed = 0;

  for (const market of marketsToResolve) {
    processed++;
    if (processed % 100 === 0) {
      console.log(
        `resolvePredictions [${workspaceId}]: ${processed}/${marketsToResolve.length} settled, ${voidedForDeadline} voided for deadline`,
      );
    }
    // A conditional pair is symmetric: whichever branch the owner chose settles
    // against the metric like any other market, and the branch they did not
    // choose is the counterfactual, which has nothing to settle against and is
    // voided. Approve and the approved branch pays; decline and the declined
    // branch pays.
    //
    // Until 2026-08-30 this voided every conditional whose proposal was not
    // `approved`, so a declined proposal's surviving branch was voided at its
    // date instead of paying the people who priced it. That silently withheld
    // the calibration record on declines that /api/help and the guides both
    // promise (owner, 2026-08-30: "on the declined branch it's the other way
    // around, so the declined market goes further, and the approved one is
    // voided").
    //
    // A proposal still pending at the settle instant decided nothing, so
    // neither branch has a world to settle in and both void.
    const decided = market.proposalId ? proposalStatusMap.get(market.proposalId) : undefined;
    const decidedBranch = market.proposalId
      ? conditionalBranchToSettle(decided?.status, decided?.decidedOption ?? null)
      : null;
    // `branch` is NULL on natural-trajectory markets, and on conditional rows
    // old enough to predate the column. The trade router already reads a
    // missing branch as "approved" for back-compat, so settlement does too:
    // a legacy pair keeps resolving exactly as it did.
    const marketBranch = market.branch ?? 'approved';
    if (market.proposalId && marketBranch !== decidedBranch) {
      await voidMarket(market, workspaceId);
    } else {
      const result = await resolveMarketRow(market, metricMap, workspaceId);
      if (!result.skipped) {
        totalPayout += result.totalPayout;
        resolvedCount++;
      }
    }
  }

  return { resolved: resolvedCount, totalPayout, remaining };
}

export type MarketStatus = 'open' | 'closed' | 'resolved' | 'voided' | 'all';

export interface GetMarketsOptions {
  includeResolved?: boolean;
  includeVoided?: boolean;
  proposalId?: string;
  active?: boolean;
  /**
   * Canonical lifecycle filter. When set, takes precedence over
   * includeResolved / includeVoided / active.
   *  - 'open'     active markets that accept buys and sells (default)
   *  - 'closed'   TP-deactivated, sell-only, not resolved
   *  - 'resolved' settled markets
   *  - 'voided'   cancelled / refunded markets
   *  - 'all'      every market regardless of state
   */
  status?: MarketStatus;
  minLiquidity?: number;
  limit?: number;
  /**
   * Filter by market kind:
   *  - 'baseline' (default when no proposalId): rows where proposalId is null
   *  - 'conditional': rows with any proposalId set
   *  - 'all': both
   * Ignored when opts.proposalId is set (that already pins to one proposal).
   */
  kind?: 'baseline' | 'conditional' | 'all';
  /** Markets opened or settled at or after this instant. What makes a
   *  settled, voided or all-states list answerable without `proposalId`. */
  since?: Date;
  /** The `X-Next-Cursor` of the previous page, as issued. */
  cursor?: string;
}

/** The most markets one listing answers (docs/guides/markets.md, "Where to look"). */
export const MARKETS_PAGE_MAX = 500;

/**
 * Where the next page of a listing starts: the ordering it belongs to and the
 * last row's key under it. `created` pages on (created_at, id) ascending, the
 * key being the database's own text for created_at so it is exact to the
 * microsecond; `liquidity` pages on liquidity descending, then id.
 */
type MarketsCursor = { order: 'created'; key: string; id: string } | { order: 'liquidity'; key: number; id: string };

const TIMESTAMP_TEXT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;

function encodeMarketsCursor(c: MarketsCursor): string {
  return Buffer.from(JSON.stringify([c.order, c.key, c.id])).toString('base64url');
}

function decodeMarketsCursor(raw: string): MarketsCursor | null {
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(v) || v.length !== 3 || typeof v[2] !== 'string') return null;
    if (v[0] === 'created' && typeof v[1] === 'string' && TIMESTAMP_TEXT.test(v[1])) {
      return { order: 'created', key: v[1], id: v[2] };
    }
    if (v[0] === 'liquidity' && typeof v[1] === 'number' && Number.isFinite(v[1])) {
      return { order: 'liquidity', key: v[1], id: v[2] };
    }
    return null;
  } catch {
    return null;
  }
}

export async function getMarkets(
  options: GetMarketsOptions | boolean = false,
  proposalId: string | undefined,
  workspaceId: string,
) {
  const opts: GetMarketsOptions = typeof options === 'boolean' ? { includeResolved: options, proposalId } : options;
  return (await listMarkets(opts, workspaceId)).rows;
}

/**
 * One page of a workspace's markets (docs/guides/markets.md, "Where to look";
 * docs/infra/deploy.md, "Reads are bounded in the size of a workspace").
 * Status, kind, liquidity and the page limit are the database's; a page holds
 * at most MARKETS_PAGE_MAX rows and `nextCursor` names the next one. A
 * settled, voided or all-states list is a workspace's whole history, millions
 * of books on a floor that opens a pair a second, so it needs `proposalId` or
 * `since`.
 */
export async function listMarkets(
  opts: GetMarketsOptions,
  workspaceId: string,
): Promise<{ rows: ReturnType<typeof marketListRow>[]; nextCursor: string | null }> {
  // Resolve which lifecycle states the caller actually wants. Explicit
  // `status` is authoritative. Otherwise: if any legacy flag is set, treat
  // the call as legacy; if nothing is set, default to status='open' so a
  // bare `GET /api/predictions/markets` returns tradeable markets only.
  const anyLegacy = opts.active !== undefined || !!opts.includeResolved || !!opts.includeVoided;
  const effectiveStatus: MarketStatus | 'legacy' = opts.status ? opts.status : anyLegacy ? 'legacy' : 'open';

  const wantsResolved =
    effectiveStatus === 'resolved' ||
    effectiveStatus === 'all' ||
    (effectiveStatus === 'legacy' && !!opts.includeResolved);
  const wantsVoided =
    effectiveStatus === 'voided' || effectiveStatus === 'all' || (effectiveStatus === 'legacy' && !!opts.includeVoided);

  if ((wantsResolved || wantsVoided) && !opts.proposalId && !opts.since) {
    throw new AppError(
      'A list of settled, voided or all markets needs proposalId or since (an ISO instant); page it with X-Next-Cursor',
      400,
      undefined,
      'history_needs_narrowing',
    );
  }

  const order: MarketsCursor['order'] =
    opts.minLiquidity !== undefined || opts.limit !== undefined ? 'liquidity' : 'created';
  let after: MarketsCursor | null = null;
  if (opts.cursor !== undefined) {
    after = decodeMarketsCursor(opts.cursor);
    if (!after || after.order !== order) {
      throw new AppError('cursor is not one this listing issued: pass X-Next-Cursor back with the same query', 400);
    }
  }
  const pageSize =
    opts.limit !== undefined && opts.limit > 0 ? Math.min(opts.limit, MARKETS_PAGE_MAX) : MARKETS_PAGE_MAX;

  const kind = opts.kind ?? 'baseline';
  const lifecycle =
    effectiveStatus === 'open'
      ? and(eq(markets.active, true), eq(markets.resolved, false), eq(markets.voided, false))
      : effectiveStatus === 'closed'
        ? and(eq(markets.active, false), eq(markets.resolved, false), eq(markets.voided, false))
        : effectiveStatus === 'resolved'
          ? and(eq(markets.resolved, true), eq(markets.voided, false))
          : effectiveStatus === 'voided'
            ? eq(markets.voided, true)
            : effectiveStatus === 'all'
              ? undefined
              : and(
                  wantsResolved ? undefined : eq(markets.resolved, false),
                  wantsVoided ? undefined : eq(markets.voided, false),
                  opts.active !== undefined ? eq(markets.active, opts.active) : undefined,
                );

  const fetched = await db
    .select({
      ...getTableColumns(markets),
      cursorAt: sql<string>`"markets"."created_at"::text`,
      // Counted per listed book through the trades index, never an id list.
      tradeCount: sql<number>`(select count(*)::int from "trades" t where t.workspace_id = "markets"."workspace_id" and t.market_id = "markets"."id")`,
    })
    .from(markets)
    .where(
      and(
        eq(markets.workspaceId, workspaceId),
        opts.proposalId
          ? eq(markets.proposalId, opts.proposalId)
          : kind === 'baseline'
            ? isNull(markets.proposalId)
            : kind === 'conditional'
              ? isNotNull(markets.proposalId)
              : undefined,
        lifecycle,
        opts.minLiquidity !== undefined && opts.minLiquidity > 0
          ? gte(markets.liquidity, opts.minLiquidity)
          : undefined,
        opts.since ? or(gte(markets.createdAt, opts.since), gte(markets.resolvedAt, opts.since)) : undefined,
        after === null
          ? undefined
          : after.order === 'created'
            ? sql`("markets"."created_at", "markets"."id") > (${after.key}::timestamp, ${after.id})`
            : sql`("markets"."liquidity" < ${after.key} or ("markets"."liquidity" = ${after.key} and "markets"."id" > ${after.id}))`,
      ),
    )
    .orderBy(
      ...(order === 'created' ? [asc(markets.createdAt), asc(markets.id)] : [desc(markets.liquidity), asc(markets.id)]),
    )
    .limit(pageSize + 1);

  const more = fetched.length > pageSize;
  const page = more ? fetched.slice(0, pageSize) : fetched;
  const last = page[page.length - 1];
  const nextCursor =
    more && last
      ? encodeMarketsCursor(
          order === 'created'
            ? { order: 'created', key: last.cursorAt, id: last.id }
            : { order: 'liquidity', key: last.liquidity, id: last.id },
        )
      : null;

  // Within a page, the listing's own order: heaviest first when liquidity
  // was asked about, otherwise earliest resolution first.
  const ordered =
    order === 'liquidity'
      ? page
      : [...page].sort((a, b) => {
          const dateDiff = periodEndInstant(a.targetDate).getTime() - periodEndInstant(b.targetDate).getTime();
          if (dateDiff !== 0) return dateDiff;
          return a.targetDate.localeCompare(b.targetDate);
        });

  return { rows: ordered.map(m => marketListRow(m, Number(m.tradeCount ?? 0))), nextCursor };
}

function marketListRow(m: typeof markets.$inferSelect, tradeCount: number) {
  const shares = (m.shares as [number, number]) || [0, 0];
  const status: 'open' | 'resolved' | 'voided' | 'closed' = m.voided
    ? 'voided'
    : m.resolved
      ? 'resolved'
      : m.active === false
        ? 'closed'
        : 'open';
  return {
    id: m.id,
    metricId: m.metricId,
    metricName: m.metricName,
    targetDate: m.targetDate,
    resolvesOn: resolutionInstant(m.targetDate),
    active: m.active !== false,
    resolved: m.resolved,
    resolvedAt: m.resolvedAt ?? null,
    actualValue: m.actualValue ?? null,
    voided: m.voided,
    status,
    createdAt: m.createdAt,
    proposalId: m.proposalId ?? undefined,
    branch: m.branch ?? undefined,
    consensus: consensus(shares, m.liquidity, m.rangeMin, m.rangeMax) ?? null,
    probability: Math.round(pHigher(shares, m.liquidity) * 10000) / 10000,
    rangeMin: m.rangeMin,
    rangeMax: m.rangeMax,
    liquidity: m.liquidity,
    totalStake: m.liquidity,
    tradeCount,
    tradedVolume: m.tradedVolume ?? 0,
  };
}

export interface MarketTradePoint {
  agentId: string;
  direction: string;
  shares: number;
  cost: number;
  /**
   * 'trade' or 'redeem'. Redemptions stay in the series because the replay
   * has to walk every row that moved the book, and they are flat by
   * construction (both sides fall by the same amount). A caller rendering
   * this as a LIST rather than a line reads this field: a redemption is not
   * a trade anyone placed.
   */
  kind: string;
  consensus: number | null;
  createdAt: Date;
}

/**
 * Reconstruct the consensus right after each trade of a market. Naively
 * summing trade shares is wrong twice over:
 *
 * 1. Liquidity injections rescale the whole share vector (and b) between
 *    trades, so trades AND injections are replayed in chronological order.
 * 2. **A market does not necessarily open empty.** A conditional pair opens
 *    ANCHORED at the baseline's current value, and so does a near-horizon
 *    baseline market (`anchoredMarketState`, docs/ui-conventions.md), which
 *    means shares are already outstanding before anyone trades. Replaying
 *    from [0, 0] then reports a price the market never printed, and the chart
 *    draws that wrong level flat across the whole window before snapping to
 *    the true price at the live dot: it reads as if every trade happened at
 *    once, at the right-hand edge (owner report 2026-08-19). On the Telarchy
 *    floor a branch whose real consensus was 6.97 replayed as 26.57.
 *
 * The opening shares are not stored, so they are SOLVED for: replay once from
 * zero to learn what the trades and injections contribute, then subtract that
 * from the book as it stands today. Whatever is left was there at the open.
 * This is exact rather than a guess, needs no migration, and makes the last
 * point equal the live consensus by construction, which is the property every
 * caller depends on.
 *
 * Shared by GET /markets/:id/trades (the members' trade log) and the public
 * trading floor's consensus series (the amber line on the hero chart).
 */
export async function replayMarketTradePoints(marketId: string, workspaceId: string): Promise<MarketTradePoint[]> {
  return (await replayCache.get(marketId, workspaceId)).points;
}

/**
 * The replay bundle: everything derived from one market's trade and
 * liquidity history, computed from ONE fetch of each table and cached
 * briefly. Before this, the trade rows were fetched twice per history
 * request (once to replay, once in openingConsensus) and every 5s floor
 * poll re-replayed the full history. The cache is dropped the instant a
 * trade or liquidity change lands (lib/market-events.ts), so a fresh price
 * never waits out the TTL.
 */
interface ReplayBundle {
  market: typeof markets.$inferSelect | null;
  points: MarketTradePoint[];
  /** The consensus the market carried before anyone traded it. */
  opening: number | null;
}

const replayCache = ttlCache({
  ttlMs: 30_000,
  keyOf: (marketId: string, workspaceId: string) => `${workspaceId}:${marketId}`,
  load: (marketId: string, workspaceId: string) => computeReplayBundle(marketId, workspaceId),
});

onPricesChanged((workspaceId, marketId) => {
  const drop = () => {
    if (marketId) replayCache.invalidate(`${workspaceId}:${marketId}`);
    // A floor-wide change drops that floor's histories, never the whole site's.
    else replayCache.invalidateWhere((_marketId, ws) => ws === workspaceId);
  };
  drop();
  // Again once the write commits: a history read between the emit and the
  // commit would otherwise keep a pre-commit replay for the whole TTL. A
  // change heard from another instance lands here too (lib/price-channel.ts).
  afterCommit(drop);
});

/** Test seam. */

/**
 * A book, its trades and its liquidity events, oldest first, for every book of
 * one workspace whose replay is asked for at the same moment: three queries
 * for the burst, not three per book (docs/infra/deploy.md, "A burst of
 * per-book reads costs a fixed number of statements"). A floor opening a
 * proposal with options replays every option book at once. A book not in the
 * workspace is absent.
 */
const replayRowsOf = coalesce<
  { workspaceId: string; marketId: string },
  {
    market: typeof markets.$inferSelect;
    rows: Array<typeof trades.$inferSelect>;
    liqRows: Array<typeof liquidityEvents.$inferSelect>;
  }
>({
  groupOf: k => k.workspaceId,
  keyOf: k => k.marketId,
  loadMany: async keys => {
    const workspaceId = keys[0].workspaceId;
    const books = await db
      .select()
      .from(markets)
      .where(
        and(
          eq(markets.workspaceId, workspaceId),
          inArray(
            markets.id,
            keys.map(k => k.marketId),
          ),
        ),
      );
    if (books.length === 0) return new Map();
    const ids = books.map(b => b.id);

    // Rows written at the same instant keep the order they were written in
    // (`ctid`), which is the order the per-book index scan this replaced
    // returned them in. It matters: a book whose first move is a redemption
    // rewinds whichever of its two same-instant rows comes first to find the
    // opening price.
    const tradeRows = await db
      .select()
      .from(trades)
      .where(and(eq(trades.workspaceId, workspaceId), inArray(trades.marketId, ids)))
      .orderBy(asc(trades.createdAt), sql`"trades"."ctid"`);

    const liquidityRows = await db
      .select()
      .from(liquidityEvents)
      .where(
        and(
          eq(liquidityEvents.workspaceId, workspaceId),
          inArray(liquidityEvents.marketId, ids),
          gt(liquidityEvents.totalLiquidity, 0),
        ),
      )
      .orderBy(asc(liquidityEvents.createdAt), sql`"liquidity_events"."ctid"`);

    const out = new Map(
      books.map(market => [market.id, { market, rows: [] as typeof tradeRows, liqRows: [] as typeof liquidityRows }]),
    );
    for (const t of tradeRows) out.get(t.marketId)?.rows.push(t);
    for (const l of liquidityRows) out.get(l.marketId)?.liqRows.push(l);
    return out;
  },
});

async function computeReplayBundle(marketId: string, workspaceId: string): Promise<ReplayBundle> {
  const loaded = await replayRowsOf({ workspaceId, marketId });
  if (!loaded) return { market: null, points: [], opening: null };
  const { market, rows, liqRows } = loaded;

  type Ev =
    | { at: number; kind: 'trade'; trade: (typeof rows)[number] }
    | { at: number; kind: 'liquidity'; totalLiquidity: number };
  const events: Ev[] = [
    ...rows.map(t => ({ at: t.createdAt.getTime(), kind: 'trade' as const, trade: t })),
    ...liqRows.map(l => ({ at: l.createdAt.getTime(), kind: 'liquidity' as const, totalLiquidity: l.totalLiquidity })),
  ];
  events.sort((a, b) => a.at - b.at || (a.kind === b.kind ? 0 : a.kind === 'liquidity' ? -1 : 1));

  // The market's b when it opened: the first injection's total (creation funds
  // the book through one), else whatever it carries now.
  const openingLiquidity = events.find(e => e.kind === 'liquidity')?.totalLiquidity ?? market.liquidity;

  /** One pass over the events. `emit` is off for the solving pass. */
  function walk(opening: [number, number], emit: boolean) {
    let shares: [number, number] = [...opening] as [number, number];
    let liquidity = openingLiquidity;
    // How much the opening shares themselves get rescaled along the way, so
    // the solve below can divide it back out.
    let openingScale = 1;
    const points: MarketTradePoint[] = [];
    for (const ev of events) {
      if (ev.kind === 'liquidity') {
        if (liquidity > 0 && ev.totalLiquidity > 0) {
          const ratio = ev.totalLiquidity / liquidity;
          shares = [shares[0] * ratio, shares[1] * ratio];
          openingScale *= ratio;
        }
        liquidity = ev.totalLiquidity;
        continue;
      }
      const t = ev.trade;
      const directionIndex = t.direction === 'higher' ? 1 : 0;
      shares = [...shares] as [number, number];
      shares[directionIndex] += t.shares;
      if (emit) {
        points.push({
          agentId: t.agentId,
          direction: t.direction,
          shares: Math.abs(t.shares),
          cost: t.cost,
          kind: t.kind,
          consensus: consensus(shares, liquidity, market.rangeMin, market.rangeMax) ?? null,
          createdAt: t.createdAt,
        });
        // Rows written at the same instant are ONE move, so they all carry
        // the price that move ended on. A redemption is the case that
        // needs it: it writes a row per side (docs/market-integrity.md,
        // "Redemption is liability-neutral"), and priced row by row the
        // first one drew a dip the market never printed before the second
        // one undid it.
        for (let k = points.length - 2; k >= 0; k--) {
          if (points[k].createdAt.getTime() !== t.createdAt.getTime()) break;
          points[k].consensus = points[points.length - 1].consensus;
        }
      }
    }
    return { shares, openingScale, points };
  }

  // Solve for the opening shares: everything the events did not put there.
  const fromZero = walk([0, 0], false);
  const current = (market.shares as [number, number] | null) ?? [0, 0];
  const scale = fromZero.openingScale || 1;
  const opening: [number, number] = [
    (current[0] - fromZero.shares[0]) / scale,
    (current[1] - fromZero.shares[1]) / scale,
  ];
  // A negative opening means the book and its events disagree (hand-edited
  // rows, a deleted trade). Fall back to an empty open rather than invent
  // negative shares, which would price the market outside its own range.
  const seed: [number, number] = [Math.max(0, opening[0]), Math.max(0, opening[1])];

  const points = walk(seed, true).points;
  return { market, points, opening: openingConsensus(market, points, rows, liqRows) };
}

/**
 * A market's price over time, as a chart reads it: the price it OPENED at,
 * then the price after each trade.
 *
 * The opening point is not a trade, which is why it does not belong in
 * `replayMarketTradePoints` (that one answers "what did each trade do", and a
 * synthetic row there would need an agent and a cost it does not have). It
 * belongs here because a market with one trade otherwise draws as a single
 * point, and a single point cannot show when anything happened: the chart
 * back-extends it flat across the whole window and the one real move lands on
 * the right edge (owner report 2026-08-19).
 */
export async function marketPriceSeries(
  marketId: string,
  workspaceId: string,
): Promise<Array<{ at: Date; consensus: number | null }>> {
  // One cached bundle: market row, replayed points, and the opening price all
  // come from the same single fetch of the trade history.
  const { market, points, opening } = await replayCache.get(marketId, workspaceId);
  if (!market) return [];

  const series = points.map(pt => ({ at: pt.createdAt, consensus: pt.consensus }));

  // The opening price: reconstructed by rewinding the first trade out of the
  // book the replay produced, so it needs no second solve.
  if (opening === null) return series;
  const openedAt = market.createdAt ?? points[0]?.createdAt ?? new Date();
  // Never draw the open after the first trade (clock skew, a backfilled row).
  if (points.length > 0 && openedAt.getTime() >= points[0].createdAt.getTime()) return series;
  return [{ at: openedAt, consensus: opening }, ...series];
}

/** The consensus the market carried before anyone traded it. */
function openingConsensus(
  market: typeof markets.$inferSelect,
  points: MarketTradePoint[],
  /** The same rows computeReplayBundle already fetched; never refetched. */
  rows: Array<typeof trades.$inferSelect>,
  liqRows: Array<typeof liquidityEvents.$inferSelect>,
): number | null {
  if (points.length === 0) {
    return (
      consensus(
        (market.shares as [number, number] | null) ?? [0, 0],
        market.liquidity,
        market.rangeMin,
        market.rangeMax,
      ) ?? null
    );
  }
  const openingLiquidity = liqRows[0]?.totalLiquidity ?? market.liquidity;

  // Rewind the first trade out of the first replayed point: the price before
  // it is the price the market opened at, at the liquidity it opened with.
  const first = rows[0];
  if (!first) return null;
  const firstPoint = points[0];
  const dir = first.direction === 'higher' ? 1 : 0;
  // Reconstruct the book at the first point, then undo that trade.
  const p = firstPoint.consensus;
  if (p === null) return null;
  const bAtFirst = liqRows.filter(l => l.createdAt <= first.createdAt).slice(-1)[0]?.totalLiquidity ?? openingLiquidity;
  const frac = (p - market.rangeMin) / (market.rangeMax - market.rangeMin);
  if (!(frac > 0 && frac < 1)) return null;
  const diffAfter = Math.log(frac / (1 - frac)) * bAtFirst; // shares[1] - shares[0]
  const diffBefore = dir === 1 ? diffAfter - first.shares : diffAfter + first.shares;
  const pBefore = 1 / (1 + Math.exp(-diffBefore / bAtFirst));
  return Math.round((market.rangeMin + pBefore * (market.rangeMax - market.rangeMin)) * 100) / 100;
}
