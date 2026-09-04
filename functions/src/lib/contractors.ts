/**
 * Contractor scoring for the trading floor's second rail.
 *
 * Owner direction 2026-08-14 (Viktor): contractors rank by what the market
 * says their jobs are worth RIGHT NOW, not by dollars already collected. A
 * job posted minutes ago scores as soon as anyone prices it; a job the owner
 * approved and paid scores on its priced impact, not on its invoice. The
 * governing sentence lives in `docs/ui-conventions.md` ("Both leaderboards
 * rank on what the market says right now").
 *
 * The math is kept here, away from the route, so the ranking rule is
 * unit-testable without a database.
 */

/** One priced branch pair on a job: the same metric and horizon, forecast in
 *  both worlds. Consensus values come from the AMM; either side is null until
 *  that branch has liquidity. */
export interface ContractorJobPair {
  metricId: string;
  targetDate: string;
  approvedConsensus: number | null;
  declinedConsensus: number | null;
}

export interface ContractorJob {
  proposalId: string;
  proposedBy: string;
  /** proposals.status verbatim. Only 'pending' and 'approved' score. */
  status: string;
  askUsd: number | null;
  /** The pair as its books read now. What a PENDING job is valued on. */
  pairs: ContractorJobPair[];
  /** The pair as it read at the moment the owner ruled
   *  (proposals.decidedPricing). What a DECIDED job is valued on; null on a
   *  pending job and on one decided before the record existed. */
  decidedPairs: ContractorJobPair[] | null;
}

export interface ContractorEntry {
  id: string;
  name: string | null;
  /** Sum of priced impact over the poster's live jobs, in the hero metric's
   *  own unit. Signed: a job the market thinks hurts the number subtracts.
   *  null only when the workspace has no hero metric to price against, in
   *  which case the rail falls back to ranking on dollars. */
  impact: number | null;
  /** Live jobs: pending + approved. Declined/withdrawn/removed are not here. */
  jobs: number;
  pendingJobs: number;
  /** How many live jobs the market has actually put a price on. Lets the UI
   *  say "not priced yet" instead of printing a confident zero. */
  pricedJobs: number;
  /** Real dollars from approved jobs only; the second line of the row, no
   *  longer the ranking key. */
  earnedUsd: number;
}

/** A job scores only while the work can still happen. Declining, withdrawing,
 *  or removing a job takes its priced impact off the board: the market's
 *  forecast was about an action nobody is going to take. */
const LIVE_STATUSES = new Set(['pending', 'approved']);

/**
 * One job's priced impact: approved-branch consensus minus declined-branch
 * consensus, i.e. the causal effect of saying yes.
 *
 * A pending job is valued on its books as they read now. A decided job is
 * valued on the pair as recorded at the moment the owner ruled and never on
 * its books afterwards (owner ruling 2026-09-04, docs/ui-conventions.md "Top
 * contractors"): the losing branch is voided, the winning one keeps trading,
 * an untraded book can be re-anchored, and none of that is what the decision
 * was priced on. A decided job with no record is unpriced.
 *
 * A pair is priced as soon as both branches hold liquidity (both consensus
 * values present); no trade is required. Only pairs on the hero metric
 * count, so the sum stays in one unit. A job priced on several horizons of
 * that metric contributes its largest-magnitude horizon (never the sum,
 * which would count the same job once per target date). Returns null when
 * nothing on the hero metric is priced on both sides.
 */
export function jobImpact(job: ContractorJob, heroMetricId: string): number | null {
  const pairs = job.status === 'pending' ? job.pairs : (job.decidedPairs ?? []);
  let best: number | null = null;
  for (const pair of pairs) {
    if (pair.metricId !== heroMetricId) continue;
    if (pair.approvedConsensus === null || pair.declinedConsensus === null) continue;
    const delta = pair.approvedConsensus - pair.declinedConsensus;
    if (best === null || Math.abs(delta) > Math.abs(best)) best = delta;
  }
  return best;
}

/**
 * Rank the workspace's contractors.
 *
 * `heroMetricId` is the metric of the soonest-resolving baseline market (what
 * the floor's chart is showing). When the workspace has no such market there
 * is nothing to price impact against, so entries carry impact null and the
 * board falls back to dollars earned, which is what it ranked on before.
 *
 * House accounts are deliberately NOT excluded (unlike the trader board): a
 * contractor's score is priced by other participants, so it cannot be
 * self-granted the way a credit balance can.
 */
export function computeContractors(
  jobs: ContractorJob[],
  heroMetricId: string | null,
  nameById: Map<string, string | null>,
  limit: number,
): ContractorEntry[] {
  const byAgent = new Map<string, ContractorEntry>();
  const ensure = (id: string): ContractorEntry => {
    let e = byAgent.get(id);
    if (!e) {
      e = {
        id,
        name: nameById.get(id) ?? null,
        impact: heroMetricId ? 0 : null,
        jobs: 0,
        pendingJobs: 0,
        pricedJobs: 0,
        earnedUsd: 0,
      };
      byAgent.set(id, e);
    }
    return e;
  };

  for (const job of jobs) {
    if (!LIVE_STATUSES.has(job.status)) continue;
    const e = ensure(job.proposedBy);
    e.jobs += 1;
    if (job.status === 'pending') e.pendingJobs += 1;
    if (job.status === 'approved') e.earnedUsd += job.askUsd ?? 0;
    if (!heroMetricId) continue;
    const impact = jobImpact(job, heroMetricId);
    if (impact === null) continue;
    e.pricedJobs += 1;
    e.impact = (e.impact ?? 0) + impact;
  }

  const entries = Array.from(byAgent.values()).map(e => ({
    ...e,
    impact: e.impact === null ? null : Math.round(e.impact * 100) / 100,
  }));
  // Priced impact first, dollars as the tiebreak, then job count, so a
  // contractor whose jobs are not priced yet still sits above nobody rather
  // than jumping the queue.
  entries.sort((a, b) => {
    const ai = a.impact ?? 0,
      bi = b.impact ?? 0;
    if (bi !== ai) return bi - ai;
    if (b.earnedUsd !== a.earnedUsd) return b.earnedUsd - a.earnedUsd;
    return b.jobs - a.jobs;
  });
  return entries.slice(0, limit);
}
