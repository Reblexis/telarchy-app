import { db } from '../db/client';
import { agents, markets, metrics as metricsTable, proposals, trades, systemConfig, liquidityEvents, workspaces } from '../db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { consensus, anchoredMarketState } from '../lib/amm';
import { voidMarket } from './markets';
import { AppError } from '../lib/errors';
import { MIN_LIQUIDITY_CONTRIBUTION, sufficientBalance, toUnits, fromUnits } from '../lib/validation';
import { emitEvent } from './events';
import { resolveWorkspaceOwnerAgentId } from '../lib/participants';
import { resolutionInstant } from '../lib/date-utils';

type MarketRow = typeof markets.$inferSelect;

async function getTradeCountMap(marketIds: string[], workspaceId: string): Promise<Map<string, number>> {
  if (marketIds.length === 0) return new Map();
  const rows = await db.select({ marketId: trades.marketId, count: sql<number>`count(*)::int` })
    .from(trades)
    .where(and(eq(trades.workspaceId, workspaceId), inArray(trades.marketId, marketIds)))
    .groupBy(trades.marketId);
  return new Map(rows.map(r => [r.marketId, r.count]));
}

async function getBaselineConsensusMap(marketRows: MarketRow[], workspaceId: string): Promise<Map<string, number>> {
  if (marketRows.length === 0) return new Map();
  const metricIds = [...new Set(marketRows.map(m => m.metricId))];
  const wantedKeys = new Set(marketRows.map(m => `${m.metricId}:${m.targetDate}`));

  const openMarkets = await db.select().from(markets)
    .where(and(
      eq(markets.workspaceId, workspaceId),
      eq(markets.resolved, false),
      inArray(markets.metricId, metricIds),
    ));

  const map = new Map<string, number>();
  for (const m of openMarkets) {
    if (m.proposalId || !m.active) continue;
    const key = `${m.metricId}:${m.targetDate}`;
    if (!wantedKeys.has(key) || map.has(key)) continue;
    const shares = (m.shares as [number, number]) || [0, 0];
    const c = consensus(shares, m.liquidity, m.rangeMin, m.rangeMax);
    if (c !== undefined) map.set(key, c);
  }
  return map;
}

export interface CreateConditionalMarketsOptions {
  /**
   * Per-branch-market credit subsidy by contributor: agentId -> credits per
   * spawned market. Each proposal spawns two markets per (metric, targetDate)
   * tuple (approved + declined), so each contributor's upfront cost is
   * contribution * spawnedMarketCount. Empty/absent means no subsidy.
   * Source of truth is proposals.subsidyContributions, so rollover re-spawns
   * re-seed the same per-market amounts (top-ups persist).
   */
  contributions?: Record<string, number>;
  /**
   * When true (creation path), an underfunded contributor aborts with an
   * AppError so the request fails loudly. When false (rollover re-spawn,
   * background-ish), underfunded contributors are skipped with a
   * console.error and the markets spawn with the remaining subsidy.
   */
  strict?: boolean;
}

export const CONDITIONAL_BRANCHES = ['approved', 'declined'] as const;
export type ConditionalBranch = typeof CONDITIONAL_BRANCHES[number];

/**
 * Contributions map for a proposal row, falling back to attributing the
 * legacy liquiditySubsidy to the proposer for rows that predate the
 * subsidy_contributions column (migration 0037 backfills, this guards the
 * window where code runs ahead of the migration).
 */
export function subsidyContributionsOf(
  proposal: { subsidyContributions?: Record<string, number> | null; liquiditySubsidy?: number | null; proposedBy: string },
): Record<string, number> {
  const map = proposal.subsidyContributions ?? {};
  if (Object.keys(map).length > 0) return map;
  const legacy = proposal.liquiditySubsidy ?? 0;
  return legacy > 0 ? { [proposal.proposedBy]: legacy } : {};
}

export async function createConditionalMarkets(
  proposalId: string,
  workspaceId: string,
  options: CreateConditionalMarketsOptions = {},
): Promise<string[]> {
  const contributions = Object.entries(options.contributions ?? {})
    .filter(([, perMarket]) => typeof perMarket === 'number' && perMarket > 0);
  const subsidy = contributions.reduce((sum, [, perMarket]) => sum + perMarket, 0);
  if (subsidy > 0 && subsidy < MIN_LIQUIDITY_CONTRIBUTION) {
    throw new AppError(
      `Liquidity subsidy must be at least ${MIN_LIQUIDITY_CONTRIBUTION} credits per market (LMSR b below this is butterfly-sensitive)`,
      400,
    );
  }
  const lockKey = `lock:proposalMarket:${proposalId}`;

  const acquired = await db.transaction(async tx => {
    const rows = await tx.select().from(systemConfig)
      .where(eq(systemConfig.key, lockKey))
      .for('update');
    const existing = rows[0]?.value as { locked?: boolean; expiresAt?: number } | undefined;
    if (existing?.locked && (existing.expiresAt ?? 0) > Date.now()) return false;
    await tx.insert(systemConfig)
      .values({ key: lockKey, value: { locked: true, expiresAt: Date.now() + 300_000 } })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value: { locked: true, expiresAt: Date.now() + 300_000 } },
      });
    return true;
  });

  if (!acquired) {
    const existing = await db.select({ id: markets.id }).from(markets)
      .where(and(eq(markets.workspaceId, workspaceId), eq(markets.proposalId, proposalId), eq(markets.resolved, false)));
    return existing.map(m => m.id);
  }

  try {
    const metricRows = await db.select().from(metricsTable)
      .where(eq(metricsTable.workspaceId, workspaceId));

    const leafMetricIds = new Set(
      metricRows.filter(r => !r.formula || r.formula === '0').map(r => r.id),
    );

    const openMarkets = await db.select().from(markets)
      .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)));

    const sourceMarkets = openMarkets.filter(m => m.active !== false && !m.proposalId && leafMetricIds.has(m.metricId));

    // The anchor (owner decision 2026-08-11): a fresh conditional pair
    // opens at the BASELINE market's current value, not the range
    // midpoint, because a pair sitting at the center reads as a forecast
    // nobody made. The approved branch additionally opens at baseline
    // minus the job's ask: approving a $200 job burns $200 into the
    // resolving metric the day it is paid, so "same as baseline" would
    // already be a bullish claim. Traders then price the upside from an
    // honest zero point. An unfunded baseline has no price; those pairs
    // still open at the center.
    const [proposalRowForAsk] = await db.select({ askUsd: proposals.askUsd, title: proposals.title }).from(proposals)
      .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
    // Rows that predate the askUsd column carry the price only as the
    // "$N: ..." title convention; parse it back so their approved branch
    // still opens ask-adjusted.
    const titleAsk = proposalRowForAsk?.title?.match(/^\$(\d+):/)?.[1];
    const askUsd = proposalRowForAsk?.askUsd ?? (titleAsk ? parseInt(titleAsk, 10) : 0);
    const anchorFor = (src: typeof sourceMarkets[number], branch: ConditionalBranch): number | null => {
      const c0 = consensus(src.shares as [number, number], src.liquidity, src.rangeMin, src.rangeMax);
      if (c0 === undefined) return null;
      const value = branch === 'approved' ? c0 - askUsd : c0;
      const span = src.rangeMax - src.rangeMin;
      return span > 0 ? (value - src.rangeMin) / span : null;
    };
    // Desired set is (metric, targetDate, branch) so both branches are tracked.
    const desiredKeys = new Set<string>();
    for (const src of sourceMarkets) {
      for (const branch of CONDITIONAL_BRANCHES) {
        desiredKeys.add(`${src.metricId}:${src.targetDate}:${branch}`);
      }
    }

    const existingConditional = await db.select().from(markets)
      .where(and(eq(markets.workspaceId, workspaceId), eq(markets.proposalId, proposalId), eq(markets.resolved, false)));

    const keyOf = (metricId: string, targetDate: string, branch: string) =>
      `${metricId}:${targetDate}:${branch}`;
    const existingByKey = new Map<string, typeof existingConditional[number]>();
    for (const m of existingConditional) {
      existingByKey.set(keyOf(m.metricId, m.targetDate, m.branch ?? 'approved'), m);
    }

    // Incremental sync: keep existing markets that still belong, spawn the
    // missing (metric, targetDate, branch) tuples, void only the ones no
    // longer in the desired set. This preserves trade history on legacy
    // proposals that had only the approved branch before the dual-branch
    // migration (the missing declined-branch markets are added on the next
    // refresh without nuking the already-traded approved-branch markets).
    // liquidity/pool are filled in inside the funding transaction below,
    // once we know which contributors can actually cover this generation.
    const toSpawn: Array<typeof markets.$inferInsert & { anchorP: number | null }> = [];
    for (const src of sourceMarkets) {
      for (const branch of CONDITIONAL_BRANCHES) {
        const key = keyOf(src.metricId, src.targetDate, branch);
        if (existingByKey.has(key)) continue;
        const marketId = randomUUID();
        toSpawn.push({
          id: marketId, workspaceId,
          metricId: src.metricId, metricName: src.metricName, targetDate: src.targetDate,
          resolved: false, resolvedAt: null, actualValue: null, active: true, proposalId,
          branch,
          rangeMin: src.rangeMin, rangeMax: src.rangeMax,
          shares: [0, 0] as [number, number],
          liquidity: 0,
          pool: 0,
          createdAt: new Date(),
          anchorP: anchorFor(src, branch),
        });
      }
    }

    // Anything in existingConditional that is no longer in desiredKeys is a
    // stale market (its (metric, targetDate) pair was removed from active
    // leaves). Void those individually.
    const desiredKeySet = new Set(desiredKeys);
    for (const m of existingConditional) {
      const key = keyOf(m.metricId, m.targetDate, m.branch ?? 'approved');
      if (!desiredKeySet.has(key)) {
        await voidMarket(m, workspaceId);
      }
    }

    if (toSpawn.length === 0) {
      // Everything desired already exists; return existing ids.
      return existingConditional
        .filter(m => desiredKeySet.has(keyOf(m.metricId, m.targetDate, m.branch ?? 'approved')))
        .map(m => m.id);
    }

    const newMarkets = toSpawn;

    const skipped: Array<{ contributorId: string; needed: number; had: number }> = [];
    await db.transaction(async tx => {
      // Which contributors can fund this generation? Lock each contributor
      // row, then either abort (strict, creation path) or skip with a log
      // (rollover re-spawn) when one cannot cover its share.
      const funded: Array<[string, number]> = [];
      for (const [contributorId, perMarket] of contributions) {
        const cost = Math.round(perMarket * newMarkets.length * 1e6) / 1e6;
        const [agentRow] = await tx.select().from(agents).where(eq(agents.id, contributorId)).for('update');
        if (!agentRow) {
          if (options.strict) throw new AppError('Subsidy contributor agent not found', 404);
          console.error(`createConditionalMarkets: subsidy contributor ${contributorId} not found; spawning proposal ${proposalId} markets without their share`);
          skipped.push({ contributorId, needed: cost, had: 0 });
          continue;
        }
        if (!sufficientBalance(agentRow.balance as number, cost)) {
          if (options.strict) {
            throw new AppError(
              `Insufficient balance for forecast subsidy: need ${cost}, have ${fromUnits(agentRow.balance as number)}`,
              400,
            );
          }
          console.error(`createConditionalMarkets: subsidy contributor ${contributorId} has ${fromUnits(agentRow.balance as number)} < ${cost} needed; spawning proposal ${proposalId} markets without their share`);
          skipped.push({ contributorId, needed: cost, had: fromUnits(agentRow.balance as number) });
          continue;
        }
        funded.push([contributorId, perMarket]);
      }

      // A branch market with liquidity 0 has no price at all: consensus is
      // undefined, the public page has nothing to chart, and the pair reads
      // as broken rather than merely thin. When no listed contributor could
      // fund this generation (a proposer with an empty balance, typically),
      // fall back to the workspace auto-fund owner, exactly as baseline
      // markets do in insertPendingMarkets. Only if that fails too do the
      // markets spawn unfunded, which then needs an admin liquidity
      // injection, same as an unfunded baseline market.
      if (funded.length === 0) {
        const [wsRow] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId));
        const credits = wsRow?.newMarketLiquidityCredits ?? 0;
        if (wsRow?.autoFundNewMarkets && credits >= MIN_LIQUIDITY_CONTRIBUTION) {
          const ownerAgentId = await resolveWorkspaceOwnerAgentId(workspaceId);
          if (ownerAgentId) {
            const cost = Math.round(credits * newMarkets.length * 1e6) / 1e6;
            const [ownerRow] = await tx.select().from(agents).where(eq(agents.id, ownerAgentId)).for('update');
            if (ownerRow && sufficientBalance(ownerRow.balance as number, cost)) {
              funded.push([ownerAgentId, credits]);
              console.error(`createConditionalMarkets: no subsidy contributor could fund proposal ${proposalId}; auto-funded ${credits}/market from workspace owner ${ownerAgentId}`);
            } else {
              console.error(`createConditionalMarkets: auto-fund fallback for proposal ${proposalId} failed too (owner ${ownerAgentId} cannot cover ${cost}); markets spawn with zero liquidity`);
            }
          }
        }
      }

      const effectiveSubsidy = funded.reduce((sum, [, perMarket]) => sum + perMarket, 0);
      // Each branch opens at its anchor with b sized so the subsidy still
      // covers the worst case exactly (anchoredMarketState); an anchored
      // open buys its starting price with a slightly thinner book, never
      // with credits nobody paid in. No anchor (unpriced baseline) means
      // the classic center open at b = subsidy / ln 2.
      for (const m of newMarkets) {
        const state = m.anchorP === null
          ? { liquidity: effectiveSubsidy > 0 ? effectiveSubsidy / Math.LN2 : 0, shares: [0, 0] as [number, number] }
          : anchoredMarketState(effectiveSubsidy, m.anchorP);
        m.liquidity = state.liquidity;
        m.shares = state.shares;
        m.pool = effectiveSubsidy;
      }

      for (const [contributorId, perMarket] of funded) {
        const cost = Math.round(perMarket * newMarkets.length * 1e6) / 1e6;
        await tx.update(agents).set({
          balance: sql`${agents.balance} - ${toUnits(cost)}`,
          spentBetting: sql`${agents.spentBetting} + ${cost}`,
        }).where(eq(agents.id, contributorId));
      }

      // anchorP is spawn-time working state, not a column.
      await tx.insert(markets).values(newMarkets.map(({ anchorP: _a, ...row }) => row));

      if (funded.length > 0) {
        const liqRows = newMarkets.flatMap(m => funded.map(([contributorId, perMarket]) => ({
          id: randomUUID(),
          workspaceId,
          marketId: m.id as string,
          agentId: contributorId,
          amount: perMarket,
          poolContribution: perMarket,
          totalLiquidity: m.liquidity as number,
          type: 'proposal-subsidy',
          createdAt: new Date(),
        })));
        await tx.insert(liquidityEvents).values(liqRows);
      }
    });

    // A skipped contribution means this generation carries less liquidity
    // than the proposal record advertises. Surface it as an event so an
    // unpriceable market is a visible fact, not a console line: on the
    // strict creation path this is unreachable (insufficiency throws and
    // the route deletes the proposal), so anything landing here came from
    // a rollover respawn.
    if (skipped.length > 0) {
      emitEvent('proposal:subsidy_skipped', { proposalId, skipped }, workspaceId)
        .catch(e => console.error('emitEvent failed:', e));
    }
    // Return every market that belongs to the proposal's current desired set:
    // the newly spawned ones plus the existing ones we kept.
    const keptIds = existingConditional
      .filter(m => desiredKeySet.has(keyOf(m.metricId, m.targetDate, m.branch ?? 'approved')))
      .map(m => m.id);
    return [...keptIds, ...newMarkets.map(m => m.id as string)];
  } finally {
    await db.insert(systemConfig)
      .values({ key: lockKey, value: { locked: false, expiresAt: 0 } })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value: { locked: false, expiresAt: 0 } },
      });
  }
}

/**
 * Void every open conditional market for a proposal regardless of branch.
 * Used for withdraw / spam-decline where neither branch is realized, so all
 * stakes are refunded.
 */
export async function voidProposalMarkets(proposalId: string, workspaceId: string): Promise<void> {
  const openMarkets = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.proposalId, proposalId), eq(markets.resolved, false)));

  for (const market of openMarkets) {
    await voidMarket(market, workspaceId);
  }
}

/**
 * Void only one branch of a proposal's conditional markets. Used on approve
 * (void the 'declined' branch, keep 'approved' live until KPI resolution) and
 * on plain decline (void the 'approved' branch, keep 'declined' live).
 * Refunds positions at cost via voidMarket, so the unrealized branch behaves
 * like a futarchy refund-on-non-realization.
 */
export async function voidProposalBranch(
  proposalId: string,
  workspaceId: string,
  branch: ConditionalBranch,
): Promise<void> {
  const openMarkets = await db.select().from(markets)
    .where(and(
      eq(markets.workspaceId, workspaceId),
      eq(markets.proposalId, proposalId),
      eq(markets.resolved, false),
      eq(markets.branch, branch),
    ));

  for (const market of openMarkets) {
    await voidMarket(market, workspaceId);
  }
}

export async function approveProposal(
  proposalId: string,
  workspaceId: string,
  resolvedBy?: string | null,
): Promise<{ rewardPaid: number }> {
  const [proposal] = await db.select().from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
  if (!proposal) throw new AppError('Proposal not found', 404);
  if (proposal.status !== 'pending') throw new AppError('Proposal is not pending', 400);

  // The declined-branch counterfactual never materialises once approved, so
  // void it and refund any positions. The approved branch stays live and
  // resolves against the actual KPI at target date.
  await voidProposalBranch(proposalId, workspaceId, 'declined');

  // The proposer's stake comes back the moment the owner decides (owner
  // decision 2026-08-10), not at resolution: the declined half just came
  // back via the void above, and here the owner buys the proposer out of
  // the approved branch's LP position, so the market keeps its depth while
  // the proposer is made whole. If the owner cannot cover it, the swap is
  // skipped with a log and the proposer's claim stays where it was, paid
  // at resolution like before; a broke owner must not block an approval.
  await buyOutProposerLiquidity(proposalId, workspaceId, proposal.proposedBy);

  const [ws] = await db.select({ proposalReward: workspaces.proposalReward })
    .from(workspaces).where(eq(workspaces.id, workspaceId));
  const reward = ws?.proposalReward ?? 0;

  if (reward <= 0) {
    await db.update(proposals).set({
      status: 'approved',
      resolvedAt: new Date(),
      resolvedBy: resolvedBy ?? null,
    }).where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
    return { rewardPaid: 0 };
  }

  const ownerAgentId = await resolveWorkspaceOwnerAgentId(workspaceId);
  if (!ownerAgentId) {
    throw new AppError('Workspace has no owner participant; cannot pay proposal reward', 409);
  }
  if (ownerAgentId === proposal.proposedBy) {
    await db.update(proposals).set({
      status: 'approved',
      resolvedAt: new Date(),
      resolvedBy: resolvedBy ?? ownerAgentId,
    }).where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
    return { rewardPaid: 0 };
  }

  await db.transaction(async tx => {
    const [owner] = await tx.select().from(agents).where(eq(agents.id, ownerAgentId)).for('update');
    if (!owner) throw new AppError('Workspace owner participant not found', 409);
    if (!sufficientBalance(owner.balance as number, reward)) {
      throw new AppError(
        `Workspace owner balance insufficient to pay proposal reward: need ${reward}, have ${fromUnits(owner.balance as number)}`,
        409,
      );
    }
    await tx.update(agents)
      .set({ balance: sql`${agents.balance} - ${toUnits(reward)}` })
      .where(eq(agents.id, ownerAgentId));
    await tx.update(agents)
      .set({ balance: sql`${agents.balance} + ${toUnits(reward)}` })
      .where(eq(agents.id, proposal.proposedBy));
    await tx.update(proposals).set({
      status: 'approved',
      rewardPaid: reward,
      resolvedAt: new Date(),
      resolvedBy: resolvedBy ?? ownerAgentId,
    }).where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
  });
  return { rewardPaid: reward };
}

/** Longest decline reason we store. Generous: an owner explaining why the
 *  market's pick is not shipping should not be fighting a character limit. */
export const MAX_DECLINE_REASON = 4000;

export async function declineProposal(
  proposalId: string,
  workspaceId: string,
  resolvedBy?: string | null,
  reason?: string | null,
  refundStake = false,
): Promise<void> {
  const [proposal] = await db.select().from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
  if (!proposal) throw new AppError('Proposal not found', 404);
  if (proposal.status !== 'pending') throw new AppError('Can only decline pending proposals', 400);

  // A charter is a public promise that a declined proposal gets a written
  // reason. Enforce it here rather than trusting the caller to remember: the
  // whole value of the promise is that it cannot be quietly skipped on the one
  // decline that is embarrassing to explain.
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (trimmed.length > MAX_DECLINE_REASON) {
    throw new AppError(`declineReason must be at most ${MAX_DECLINE_REASON} characters`, 400);
  }
  if (!trimmed) {
    const [ws] = await db.select({ charter: workspaces.charter }).from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    if (ws?.charter) {
      throw new AppError(
        'This workspace publishes a charter, so declining a proposal requires a written declineReason.',
        400,
      );
    }
  }

  if (refundStake) {
    // Decline with refund (owner ask 2026-08-12): a genuine proposal the owner
    // just is not taking. Void BOTH branches so the proposer's whole staked
    // liquidity comes straight back, at the cost of the declined-branch
    // counterfactual we would otherwise keep for calibration. Use this for
    // real ideas; plain decline (below) for the calibration record.
    await voidProposalMarkets(proposalId, workspaceId);
  } else {
    // The approved-branch counterfactual never materialises once declined, so
    // void it and refund any positions. The declined branch stays live and
    // resolves against the actual KPI at target date, giving the counterfactual
    // record we use to compute calibration on declined proposals.
    await voidProposalBranch(proposalId, workspaceId, 'approved');
  }
  await db.update(proposals).set({
    status: 'declined',
    resolvedAt: new Date(),
    resolvedBy: resolvedBy ?? null,
    declineReason: trimmed || null,
  }).where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
}

export async function declineProposalAsSpam(
  proposalId: string,
  workspaceId: string,
  resolvedBy?: string | null,
): Promise<{ penaltyCharged: number }> {
  const [proposal] = await db.select().from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
  if (!proposal) throw new AppError('Proposal not found', 404);
  if (proposal.status !== 'pending') throw new AppError('Can only decline pending proposals', 400);

  await voidProposalMarkets(proposalId, workspaceId);

  const [ws] = await db.select({ spamPenalty: workspaces.spamPenalty })
    .from(workspaces).where(eq(workspaces.id, workspaceId));
  const configuredPenalty = ws?.spamPenalty ?? 0;

  let actualCharged = 0;
  const ownerAgentId = await resolveWorkspaceOwnerAgentId(workspaceId);

  if (configuredPenalty > 0 && ownerAgentId && ownerAgentId !== proposal.proposedBy) {
    await db.transaction(async tx => {
      const [proposer] = await tx.select().from(agents)
        .where(eq(agents.id, proposal.proposedBy)).for('update');
      if (!proposer) return;
      const balance = proposer.balance as number;
      const wantedUnits = toUnits(configuredPenalty);
      const chargedUnits = balance >= wantedUnits ? wantedUnits : Math.max(0, balance);
      if (chargedUnits <= 0) return;
      actualCharged = fromUnits(chargedUnits);
      await tx.update(agents)
        .set({ balance: sql`${agents.balance} - ${chargedUnits}` })
        .where(eq(agents.id, proposal.proposedBy));
      await tx.update(agents)
        .set({ balance: sql`${agents.balance} + ${chargedUnits}` })
        .where(eq(agents.id, ownerAgentId));
    });
  }

  await db.update(proposals).set({
    status: 'declined_spam',
    penaltyCharged: actualCharged,
    resolvedAt: new Date(),
    resolvedBy: resolvedBy ?? ownerAgentId ?? null,
  }).where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));

  return { penaltyCharged: actualCharged };
}

/**
 * Take a job off the board entirely (owner ask 2026-08-12): spam, a duplicate,
 * a test entry, anything that should not be part of the record participants
 * read. Any branch market still open is voided first, so every stake - the
 * proposer's posting liquidity and anyone else's positions - comes back before
 * the job disappears; nobody can be left holding a position in a market that
 * no longer shows anywhere.
 *
 * Deliberately a status, not a row delete. Trades, positions and balance
 * history reference these markets, and deleting the row would orphan ledger
 * entries that the leaderboard and profile pages read. 'removed' is filtered
 * out of every listing, so the visible effect is the same while the audit
 * trail stays intact.
 */
export async function removeProposal(
  proposalId: string,
  workspaceId: string,
  byAgentId?: string | null,
): Promise<void> {
  const [proposal] = await db.select().from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
  if (!proposal) throw new AppError('Proposal not found', 404);
  if (proposal.status === 'removed') return;

  await voidProposalMarkets(proposalId, workspaceId);
  await db.update(proposals).set({
    status: 'removed',
    resolvedAt: new Date(),
    resolvedBy: byAgentId ?? null,
  }).where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
}

export async function withdrawProposal(
  proposalId: string,
  workspaceId: string,
  byAgentId: string,
): Promise<void> {
  const [proposal] = await db.select().from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
  if (!proposal) throw new AppError('Proposal not found', 404);
  if (proposal.status !== 'pending') throw new AppError('Can only withdraw pending proposals', 400);
  if (proposal.proposedBy !== byAgentId) throw new AppError('Only the proposer may withdraw a proposal', 403);

  await voidProposalMarkets(proposalId, workspaceId);
  await db.update(proposals).set({
    status: 'withdrawn',
    resolvedAt: new Date(),
    resolvedBy: byAgentId,
  }).where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
}

export async function countPendingProposalsByProposer(
  workspaceId: string,
  proposedBy: string,
): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` })
    .from(proposals)
    .where(and(
      eq(proposals.workspaceId, workspaceId),
      eq(proposals.proposedBy, proposedBy),
      eq(proposals.status, 'pending'),
    ));
  return row?.count ?? 0;
}

export async function getProposalMarketSummaries(marketIds: string[], workspaceId: string) {
  if (marketIds.length === 0) return [];
  const rows = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), inArray(markets.id, marketIds)));
  return buildProposalMarketSummariesFromRows(rows, workspaceId);
}

export async function getProposalMarketSummariesForProposal(proposalId: string, workspaceId: string) {
  // Include voided rows so the post-decision view still shows the
  // counterfactual branch's price at the moment of refund. The LMSR shares
  // are not zeroed on void, so consensus() still computes a meaningful
  // snapshot.
  const rows = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.proposalId, proposalId)));
  return buildProposalMarketSummariesFromRows(rows, workspaceId);
}

/**
 * Per-branch market state (one row per spawned conditional market).
 * Used inside the paired summary returned to clients.
 */
export interface BranchMarketSummary {
  marketId: string;
  consensus: number | null;
  liquidity: number;
  tradeCount: number;
  resolved: boolean;
  voided: boolean;
  actualValue: number | null;
}

/**
 * Paired summary for one (metric, targetDate) under a proposal: both branches
 * plus the natural-trajectory baseline as context. `delta` is the headline
 * impact number: approved.consensus - declined.consensus.
 */
export interface PairedProposalMarketSummary {
  metricId: string;
  metricName: string;
  targetDate: string;
  resolvesOn: string | null;
  rangeMin: number;
  rangeMax: number;
  approved: BranchMarketSummary | null;
  declined: BranchMarketSummary | null;
  delta: number | null;
  baselineConsensus: number | null;
}

async function buildProposalMarketSummariesFromRows(
  rows: MarketRow[],
  workspaceId: string,
): Promise<PairedProposalMarketSummary[]> {
  const [tradeCountMap, baselineConsensusMap] = await Promise.all([
    getTradeCountMap(rows.map(r => r.id), workspaceId),
    getBaselineConsensusMap(rows, workspaceId),
  ]);

  // Group rows by (metric, targetDate). Pre-migration single-branch markets
  // were backfilled to branch='approved' so they pair with a null declined.
  const groups = new Map<string, MarketRow[]>();
  for (const m of rows) {
    const key = `${m.metricId}:${m.targetDate}`;
    const arr = groups.get(key);
    if (arr) arr.push(m);
    else groups.set(key, [m]);
  }

  const toBranchSummary = (m: MarketRow): BranchMarketSummary => {
    const shares = (m.shares as [number, number]) || [0, 0];
    return {
      marketId: m.id,
      consensus: consensus(shares, m.liquidity, m.rangeMin, m.rangeMax) ?? null,
      liquidity: m.liquidity,
      tradeCount: tradeCountMap.get(m.id) ?? 0,
      resolved: m.resolved,
      voided: m.voided,
      actualValue: m.actualValue ?? null,
    };
  };

  const out: PairedProposalMarketSummary[] = [];
  for (const [key, branchRows] of groups) {
    const first = branchRows[0];
    const approvedRow = branchRows.find(r => (r.branch ?? 'approved') === 'approved') ?? null;
    const declinedRow = branchRows.find(r => r.branch === 'declined') ?? null;
    const approved = approvedRow ? toBranchSummary(approvedRow) : null;
    const declined = declinedRow ? toBranchSummary(declinedRow) : null;
    const delta = approved?.consensus != null && declined?.consensus != null
      ? approved.consensus - declined.consensus
      : null;
    out.push({
      metricId: first.metricId,
      metricName: first.metricName,
      targetDate: first.targetDate,
      resolvesOn: resolutionInstant(first.targetDate),
      rangeMin: first.rangeMin,
      rangeMax: first.rangeMax,
      approved,
      declined,
      delta,
      baselineConsensus: baselineConsensusMap.get(key) ?? null,
    });
  }
  return out;
}


/** Owner takes over the proposer's LP rows on the proposal's still-open
 *  markets, refunding the stake at decision time instead of resolution. */
async function buyOutProposerLiquidity(
  proposalId: string,
  workspaceId: string,
  proposerId: string,
): Promise<void> {
  const ownerAgentId = await resolveWorkspaceOwnerAgentId(workspaceId);
  if (!ownerAgentId || ownerAgentId === proposerId) return;

  const openMarkets = await db.select({ id: markets.id }).from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.proposalId, proposalId), eq(markets.resolved, false)));
  if (openMarkets.length === 0) return;
  const marketIds = openMarkets.map(m => m.id);

  await db.transaction(async tx => {
    const rows = await tx.select().from(liquidityEvents)
      .where(and(
        eq(liquidityEvents.workspaceId, workspaceId),
        inArray(liquidityEvents.marketId, marketIds),
        eq(liquidityEvents.agentId, proposerId),
      ))
      .for('update');
    const stake = rows.reduce((sum, r) => sum + (r.poolContribution ?? 0), 0);
    if (stake <= 0) return;

    const [owner] = await tx.select().from(agents).where(eq(agents.id, ownerAgentId)).for('update');
    if (!owner || !sufficientBalance(owner.balance as number, stake)) {
      console.error(`buyOutProposerLiquidity: owner ${ownerAgentId} cannot cover ${stake} for proposal ${proposalId}; proposer's LP claim stays until resolution`);
      return;
    }

    await tx.update(agents).set({ balance: sql`${agents.balance} - ${toUnits(stake)}` })
      .where(eq(agents.id, ownerAgentId));
    await tx.update(agents).set({ balance: sql`${agents.balance} + ${toUnits(stake)}` })
      .where(eq(agents.id, proposerId));
    for (const row of rows) {
      await tx.update(liquidityEvents).set({ agentId: ownerAgentId })
        .where(eq(liquidityEvents.id, row.id));
    }
  });
}
