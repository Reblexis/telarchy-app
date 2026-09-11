/**
 * Where a conditional branch opens (docs/guides/creating.md, "A conditional
 * pair opens at the baseline price"): the baseline market's consensus for the
 * same metric and settle date, less the ask on every branch but the declined
 * one of a metric the payment burns out of (an option is approved-like). One formula for the two moments a branch's book
 * is first given money, the spawn (services/proposals.ts) and the first
 * injection into a branch that spawned unfunded (services/marketLiquidity.ts);
 * anchor-ownership.test.ts keeps it one.
 */

import { consensus } from './amm';
import { metricSubtractsContractAsk } from './metric-unit';

/** 'approved', 'declined', or an option id on a proposal with options
 *  (docs/guides/proposals.md, "More than two options"). Every branch but
 *  'declined' opens where the approved one does: choosing any option owes
 *  the ask, so each burns it. */
export type ConditionalBranchName = string;

/** The proposal's ask in dollars. Rows that predate the askUsd column carry
 *  the price only as the "$N: ..." title convention; parse it back so their
 *  approved branch still opens ask-adjusted. */
export function askUsdOf(proposal: { askUsd?: number | null; title?: string | null } | undefined | null): number {
  if (typeof proposal?.askUsd === 'number') return proposal.askUsd;
  const titleAsk = proposal?.title?.match(/^\$(\d+):/)?.[1];
  return titleAsk ? parseInt(titleAsk, 10) : 0;
}

/**
 * The opening probability of a branch, or null when the baseline has no
 * price (no book) or no usable range, in which case the branch opens at the
 * centre. The ask burns out of the metric only when approving actually moves
 * it: money, and net of what the owner pays out (2026-08-15). Against a
 * headcount, or against gross revenue, subtracting dollars pinned every
 * approved branch at the range floor.
 */
export function branchAnchorP(
  baseline: { shares: unknown; liquidity: number; rangeMin: number; rangeMax: number; metricName: string },
  branch: ConditionalBranchName,
  askUsd: number,
): number | null {
  const c0 = consensus(
    (baseline.shares as [number, number]) || [0, 0],
    baseline.liquidity,
    baseline.rangeMin,
    baseline.rangeMax,
  );
  if (c0 === undefined) return null;
  const burn = metricSubtractsContractAsk(baseline.metricName) ? askUsd : 0;
  const value = branch === 'declined' ? c0 : c0 - burn;
  const span = baseline.rangeMax - baseline.rangeMin;
  return span > 0 ? (value - baseline.rangeMin) / span : null;
}
