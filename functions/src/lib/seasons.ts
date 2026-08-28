/**
 * Prize seasons: a bounded cash tournament over the trading board.
 *
 * A season pays real money for settled trading profit earned while it ran.
 * This module owns the arithmetic and the rules; it touches no database, so
 * every rule below is testable in milliseconds. The SQL side is
 * `lib/board.ts`, and the money side is manual: Telarchy, as contest
 * operator, pays winners directly from its own funds, outside the Service
 * (ToS 3a since v1.6, 2026-08-28).
 *
 * THE STATE MACHINE
 *
 *   draft ──POST /admin/seasons/:id/start──► running ──POST .../settle──► settled
 *     │                                         │                            │
 *     │  pool, ladder, dates editable           │  nothing editable          │  finals frozen
 *     │  no baselines exist                     │  baselines pinned          │  ranks + prizes assigned
 *     │  standings read empty                   │  standings computed LIVE   │  standings read STORED
 *     │                                         │                            │
 *     └── workspaceIds pinned at start ─────────┘                            └── claim window: 30 days
 *
 * Settle is reachable ONLY from `running`. A second settle would recompute at
 * new prices and could reassign a prize already paid, with nothing recording
 * that the winner changed. That guard is the whole reason `status` exists.
 *
 * THE SCORE
 *
 * From SETTLED_SCORING_EFFECTIVE_AT (rules amended 2026-08-28):
 *
 *   season_score(agent) = settled profit on markets resolved inside the
 *                         season window (lib/leaderboard.ts,
 *                         computeSettledWindowProfit)
 *
 * The window on `markets.resolvedAt` is the baseline: nothing marked enters
 * the score, entering late changes nothing, and trades inside a market's
 * final SEASON_TRADE_CUTOFF_HOURS do not count. Before the effective
 * instant the previous rule applied:
 *
 *   season_score(agent) = board_profit(now) - baseline_profit(agent)
 *
 * where `baseline_profit` was snapshotted for EVERY participant at the
 * instant the season started, not at the instant they opted in
 * (baseline-at-entry would have made opting in a free option on a
 * drawdown). Start still snapshots those baselines; under settled scoring
 * they are a record, not an input.
 *
 * THE PAYOUT
 *
 * Two modes (`prize_seasons.payout_mode`):
 *
 *  - `proportional` (rules amended 2026-08-28, the shape from Season 0's
 *    second amendment onward): the pool is split among eligible entrants in
 *    proportion to their positive season score. Negative and zero scores are
 *    paid nothing and do not shrink anyone else's share. Linear-in-score on
 *    purpose: under a linear payout, moving score between colluding accounts
 *    changes the coalition's total expected payout by nothing, which is the
 *    licence-free Sybil property the rank ladder lacked (design record:
 *    telarchy umbrella notes/trader-rewards-design-2026-08-28.md). Shares
 *    below the season's `min_payout_usd` and anything above
 *    MAX_SINGLE_PAYOUT_USD roll forward instead of being paid.
 *  - `ladder` (Season 0 as originally published): prizes go to eligible
 *    entrants in rank order until the rungs run out.
 *
 * Anything unassigned rolls into the next season's pool in both modes.
 *
 * KNOWN AND ACCEPTED (owner decisions, 2026-08-17). Recorded here because the
 * next person to read this file should not have to rediscover them:
 *
 *  - Ranking on marked-to-market profit is exploitable on a thin book: a
 *    participant can move a price, have their own position marked up, and top
 *    the standings without any market resolving. Raised three times and kept,
 *    until the live Season 0 board showed +1425 marked with 0.00 settled at
 *    rank 1; since 2026-08-28 the season ranks settled profit and the mark
 *    is display only (docs/seasons.md, "The score").
 *  - No Sybil defence. Credits are free, entry is free, and a new account
 *    baselines at 0, so one person running several accounts is the cheapest way
 *    to farm the ladder. Season 0 relies on manual settlement and a
 *    disqualification clause instead. See TODOS.md, P2 prize seasons.
 *  - A market voided mid-season is treated asymmetrically by the underlying
 *    profit formula (a losing buy reads as zero, a realised gain is kept). The
 *    published rules commit the operator to not voiding during a running season
 *    except for a declared, announced error.
 */

/**
 * When the settled-profit season score takes effect: the day it was
 * announced (rules amended 2026-08-28, effective immediately at the owner's
 * direction, "why, change them now", same-day effect like the 2026-08-22
 * and 2026-08-25 amendments; a 2026-09-01 notice period shipped for a few
 * hours and was dropped the same day; decision record
 * notes/decisions/seasons.md). Before this instant the standings rank the
 * previous marked-to-market growth; from it, they rank settled profit on
 * markets resolved inside the season window. The env override exists for
 * tests, which must not change behaviour with the wall clock.
 */
export const SETTLED_SCORING_DEFAULT_AT = '2026-08-28T00:00:00Z';

/** Read per call, not at import, so tests can pin either era without
 *  fighting module-load order. */
export function settledScoringEffectiveAt(): Date {
  return new Date(process.env.SEASON_SETTLED_SCORING_AT ?? SETTLED_SCORING_DEFAULT_AT);
}

export function settledScoringActive(now: Date = new Date()): boolean {
  return now >= settledScoringEffectiveAt();
}

/**
 * Trades inside a market's final hours do not count toward the season score
 * (rules amended 2026-08-28): the market stays tradeable, because late
 * trading keeps the floor's number honest, but a reading that is already
 * visible cannot be farmed for prize money. Scoring-side only; nothing
 * closes a market early.
 */
export const SEASON_TRADE_CUTOFF_HOURS = 6;

/** How a season's pool is assigned at settlement. See THE PAYOUT above. */
export type SeasonPayoutMode = 'ladder' | 'proportional';

/**
 * No single payout may exceed the CZK 50,000 tax-withholding line (about
 * $2,100; Czech law has the organizer withhold 15% above it, and nothing is
 * set up to withhold yet). Kept safely under the line rather than at it,
 * because the koruna rate moves and the constant does not. The clipped
 * remainder rolls into the next season's pool. Design record:
 * telarchy umbrella notes/real-money-economy-design-2026-08-26.md, point 7.
 */
export const MAX_SINGLE_PAYOUT_USD = 2000;

/** One rung of the published prize ladder. */
export interface LadderRung {
  /** 1-based finishing place this rung pays. */
  place: number;
  /** Prize in whole US dollars and cents. */
  prizeUsd: number;
}

export type SeasonStatus = 'draft' | 'running' | 'settled';

/** An entrant, as scoring sees them. */
export interface SeasonEntrant {
  agentId: string;
  /** Board profit at the season's start instant. Absent rows read as 0. */
  baselineProfit: number;
  /** Board profit now (running) or at the settle instant (settled). */
  currentProfit: number;
  /** When they opted in. The published first tiebreak. */
  enteredAt: Date;
  /** Operated by us: ranks and scores like anyone, never takes a rung. */
  platformOperated?: boolean;
  /** Owns or administers any PUBLIC workspace. Under strict eligibility
   *  (seasons after Season 0) such an account is shown but takes no payout,
   *  because workspace operators resolve the metrics the season is scored
   *  on (platform rule accepted 2026-08-26, applied 2026-08-28; design
   *  record in the telarchy umbrella,
   *  notes/real-money-economy-design-2026-08-26.md, premise 4). */
  workspaceOperator?: boolean;
  /** The account's payout handle, for the one-payout-identity rule under
   *  strict eligibility: entries sharing a handle collapse to the
   *  best-placed one. Null/absent when none is set (none is required until
   *  claim time). */
  payoutHandle?: string | null;
}

/** An entrant after scoring and ranking. */
export interface RankedEntrant {
  agentId: string;
  score: number;
  /** 1-based, over ALL entrants, so the standings have an order even for
   *  entrants who will not be paid. */
  rank: number;
  /** True when the score clears the eligibility bar (strictly above zero). */
  eligible: boolean;
  /** Assigned prize, or 0. Only ever non-zero when `eligible`. */
  prizeUsd: number;
}

export interface SettlementResult {
  ranked: RankedEntrant[];
  /** Pool minus everything assigned. Rolls into the next season. */
  rolloverUsd: number;
}

/** Two decimals, the same precision `computeTradingProfit` rounds to. Applied
 *  to the difference as well, because subtracting two 2dp floats reintroduces
 *  binary noise (441.51 - 13.57 is not exactly 427.94 in IEEE 754) and a score
 *  that renders as "427.94000000000005" on a public board is a bug. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * What an entrant earned inside the season window.
 *
 * Negative is a real and expected answer: an entrant can lose money during a
 * season. It is not clamped, because the standings should show it.
 */
export function seasonScore(currentProfit: number, baselineProfit: number): number {
  return round2(currentProfit - baselineProfit);
}

/**
 * The eligibility bar, in one place because the rules document quotes it and
 * the settle path enforces it.
 *
 * Since the 2026-08-22 amendment the SCORE plays no part: place alone decides
 * the prize, a zero or negative score included (owner decision 2026-08-22,
 * announced on the season page; the previous score-above-zero bar left a
 * $1,000 ladder showing dashes the moment the whole field was down). The
 * score parameter stays in the signature so a future season can reinstate a
 * bar without touching every caller.
 *
 * The identity half remains, because the published rules say
 * "participants operated by us or run as part of the platform are not
 * eligible" and until 2026-08-20 nothing checked. On the eve of Season 0 the
 * operator's own trading bot sat top of the standings of a $1,000 contest, and
 * a rule a reader can check and find broken is worse than no rule.
 *
 * Ineligible is not hidden: a house account still scores, still ranks and
 * still appears on every board (owner direction 2026-08-14, nobody excluded).
 * It just never consumes a rung.
 */
export function isPrizeEligible(_score: number, platformOperated = false): boolean {
  return !platformOperated;
}

export interface SettleOptions {
  /** Defaults to 'ladder', the mode every season row carried before the
   *  column existed. */
  payoutMode?: SeasonPayoutMode;
  /** Proportional mode only: a computed share below this is not paid and
   *  rolls forward (the Metaculus shape; dust payouts cost more to send
   *  than they are worth). 0 pays every cent. */
  minPayoutUsd?: number;
  /** The two platform rules for seasons after Season 0
   *  (`prize_seasons.strict_eligibility`, default on for new seasons):
   *  accounts that own or administer any public workspace take no payout,
   *  and entries sharing a payout handle collapse to the best-placed one
   *  ("one person, one prize"). Season 0 runs with this off, because its
   *  published rules (amended 2026-08-25) made owners explicitly eligible
   *  and a mid-season eligibility flip would reduce standings, which the
   *  amendment clause forbids. */
  strictEligibility?: boolean;
}

/**
 * Rank entrants and assign the pool.
 *
 * Order is score descending, then earlier entry, then agent id. All three are
 * published in the rules: a cash prize cannot break a tie by whatever order
 * the database happened to return, and the last key guarantees the same
 * standings on a repeat run even if two people entered in the same millisecond.
 *
 * LADDER mode: rungs are consumed in place order by ELIGIBLE entrants only,
 * and since the 2026-08-22 amendment every entrant except a platform-operated
 * account is eligible, whatever their score. If three entrants are eligible
 * and the ladder has five rungs, places 4 and 5 pay nothing and their money
 * rolls forward.
 *
 * PROPORTIONAL mode: each eligible entrant with a positive score is paid
 * `pool x score / sum of positive eligible scores`, rounded to cents, then
 * zeroed under `minPayoutUsd` and clipped at MAX_SINGLE_PAYOUT_USD. The
 * ladder plays no part. Ties need no breaking for money (equal scores pay
 * equal shares); the sort order still decides the published rank.
 */
export function settleSeason(
  entrants: SeasonEntrant[],
  ladder: LadderRung[],
  poolUsd: number,
  opts: SettleOptions = {},
): SettlementResult {
  const payoutMode: SeasonPayoutMode = opts.payoutMode ?? 'ladder';
  const minPayoutUsd = opts.minPayoutUsd ?? 0;

  const scored = entrants.map(e => ({
    agentId: e.agentId,
    enteredAt: e.enteredAt,
    platformOperated: e.platformOperated === true,
    workspaceOperator: e.workspaceOperator === true,
    payoutHandle: (e.payoutHandle ?? '').trim().toLowerCase(),
    score: seasonScore(e.currentProfit, e.baselineProfit),
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const at = a.enteredAt.getTime();
    const bt = b.enteredAt.getTime();
    if (at !== bt) return at - bt;
    return a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0;
  });

  // Eligibility, decided before either payout branch so both pay the same
  // people. The base rule is isPrizeEligible (platform-operated accounts
  // never take money). Strict eligibility adds the two platform rules for
  // seasons after Season 0: a public-workspace operator takes no payout;
  // an entrant whose payout handle matches an operator's (or a house
  // account's) is treated as the same person ("shares payout details with
  // such an account"); and among the remaining eligibles, entries sharing
  // a handle collapse to the best-placed one, in the published sort order
  // so a recount agrees.
  const eligibleAt: boolean[] = [];
  if (opts.strictEligibility) {
    const operatorHandles = new Set(
      scored.filter(e => (e.workspaceOperator || e.platformOperated) && e.payoutHandle).map(e => e.payoutHandle),
    );
    const seenHandles = new Set<string>();
    for (const e of scored) {
      let eligible = isPrizeEligible(e.score, e.platformOperated) && !e.workspaceOperator;
      if (eligible && e.payoutHandle) {
        if (operatorHandles.has(e.payoutHandle) || seenHandles.has(e.payoutHandle)) eligible = false;
        else seenHandles.add(e.payoutHandle);
      }
      eligibleAt.push(eligible);
    }
  } else {
    for (const e of scored) eligibleAt.push(isPrizeEligible(e.score, e.platformOperated));
  }

  let ranked: RankedEntrant[];
  if (payoutMode === 'proportional') {
    // Only a positive score earns a share. Negative scores are not clamped in
    // the standings, but a share must not be negative and must not dilute the
    // denominator, or a big loser would enlarge everyone else's payout.
    const weightOf = (e: (typeof scored)[number], i: number) => (eligibleAt[i] && e.score > 0 ? e.score : 0);
    const denominator = scored.reduce((sum, e, i) => sum + weightOf(e, i), 0);
    ranked = scored.map((e, i) => {
      const eligible = eligibleAt[i];
      let prizeUsd = 0;
      if (denominator > 0) {
        prizeUsd = round2((poolUsd * weightOf(e, i)) / denominator);
        if (prizeUsd < minPayoutUsd) prizeUsd = 0;
        if (prizeUsd > MAX_SINGLE_PAYOUT_USD) prizeUsd = MAX_SINGLE_PAYOUT_USD;
      }
      return { agentId: e.agentId, score: e.score, rank: i + 1, eligible, prizeUsd };
    });
  } else {
    const rungByPlace = new Map(ladder.map(r => [r.place, r.prizeUsd]));

    // Rungs are consumed by eligible entrants in finishing order. `place` walks
    // the ladder independently of `rank`, so an ineligible entrant sitting above
    // an eligible one does not burn a rung.
    let place = 0;
    ranked = scored.map((e, i) => {
      const eligible = eligibleAt[i];
      let prizeUsd = 0;
      if (eligible) {
        place += 1;
        prizeUsd = rungByPlace.get(place) ?? 0;
      }
      return { agentId: e.agentId, score: e.score, rank: i + 1, eligible, prizeUsd };
    });
  }

  const assigned = ranked.reduce((sum, r) => sum + r.prizeUsd, 0);
  return { ranked, rolloverUsd: round2(poolUsd - assigned) };
}

/** Total the ladder promises. Used to reject a season whose rungs exceed its
 *  pool at creation time, rather than discovering it at settlement. */
export function ladderTotal(ladder: LadderRung[]): number {
  return round2(ladder.reduce((sum, r) => sum + r.prizeUsd, 0));
}

/**
 * Whether a season is accepting entries right now. Opting in is free and
 * requires no payment details (those are collected at claim time), so this is
 * the only gate on the toggle.
 *
 * A DRAFT season accepts entries (owner direction 2026-08-18). Entry used to
 * open only once a season was running, which meant the announcement, the
 * countdown and the entry button could not exist before the start instant:
 * everyone who heard about the season early had to be asked to come back. That
 * is the worst possible funnel for the one moment the season has attention.
 *
 * Pre-registering changes nothing about fairness, because the baseline is
 * snapshotted for EVERY participant at the start instant regardless of when
 * they opted in. Entering on day minus two and entering on day one produce the
 * same starting score; the only thing pre-registration buys is not having to
 * remember.
 */
export function isOpenForEntry(status: SeasonStatus, now: Date, endsAt: Date): boolean {
  if (status === 'draft') return true;
  return status === 'running' && now < endsAt;
}

/** How long a winner has to supply payment details before their prize rolls
 *  into the next pool. Published in the rules. */
export const CLAIM_WINDOW_DAYS = 30;

export function claimDeadline(settledAt: Date): Date {
  return new Date(settledAt.getTime() + CLAIM_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}
