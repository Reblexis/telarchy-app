/**
 * Prize seasons: a bounded cash tournament over the trading board.
 *
 * A season pays real money to the entrants whose marked trading profit grew
 * most while it ran. This module owns the arithmetic and the rules; it touches
 * no database, so every rule below is testable in milliseconds. The SQL side is
 * `lib/board.ts`, and the money side is manual: the owner pays winners directly,
 * outside the Service, exactly as ToS section 3 already describes for paid jobs.
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
 *   season_score(agent) = board_profit(now) - baseline_profit(agent)
 *
 * `baseline_profit` is snapshotted for EVERY participant at the instant the
 * season starts, not at the instant they opt in. Baseline-at-entry would make
 * opting in a free option: a trader sitting on an unrealised loss could wait
 * for their trough, enter there, and bank the rebound as season profit, while
 * a trader who entered on day one ate the same drawdown for nothing. An account
 * that did not exist at season start has no baseline row, which reads as 0, so
 * newcomers are scored on exactly what they earn inside the window.
 *
 * THE LADDER
 *
 * Prizes go to eligible entrants in rank order until the rungs run out.
 * Eligible means a season score strictly above zero: without that, a season
 * where nobody moved would still pay out the whole ladder to entrants sitting
 * at exactly 0.00, ordered by a tiebreak. Anything unassigned rolls forward.
 *
 * KNOWN AND ACCEPTED (owner decisions, 2026-08-17). Recorded here because the
 * next person to read this file should not have to rediscover them:
 *
 *  - Ranking on marked-to-market profit is exploitable on a thin book: a
 *    participant can move a price, have their own position marked up, and top
 *    the standings without any market resolving. Raised three times and kept
 *    ("we will mitigate later by improving markets design"). The hedge is to
 *    end a season only after at least one of its markets resolves.
 *  - No Sybil defence. Credits are free, entry is free, and a new account
 *    baselines at 0, so one person running several accounts is the cheapest way
 *    to farm the ladder. Season 0 relies on manual settlement and a
 *    disqualification clause instead. See TODOS.md, P2 prize seasons.
 *  - A market voided mid-season is treated asymmetrically by the underlying
 *    profit formula (a losing buy reads as zero, a realised gain is kept). The
 *    published rules commit the operator to not voiding during a running season
 *    except for a declared, announced error.
 */

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

/**
 * Rank entrants and assign the ladder.
 *
 * Order is score descending, then earlier entry, then agent id. All three are
 * published in the rules: a cash ladder cannot break a tie by whatever order
 * the database happened to return, and the last key guarantees the same
 * standings on a repeat run even if two people entered in the same millisecond.
 *
 * Rungs are consumed in place order by ELIGIBLE entrants only, and since the
 * 2026-08-22 amendment every entrant except a platform-operated account is
 * eligible, whatever their score. If three entrants are eligible and the
 * ladder has five rungs, places 4 and 5 pay nothing and their money rolls
 * forward; a rung nobody consumes rolls into the next season's pool.
 */
export function settleSeason(entrants: SeasonEntrant[], ladder: LadderRung[], poolUsd: number): SettlementResult {
  const scored = entrants.map(e => ({
    agentId: e.agentId,
    enteredAt: e.enteredAt,
    platformOperated: e.platformOperated === true,
    score: seasonScore(e.currentProfit, e.baselineProfit),
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const at = a.enteredAt.getTime();
    const bt = b.enteredAt.getTime();
    if (at !== bt) return at - bt;
    return a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0;
  });

  const rungByPlace = new Map(ladder.map(r => [r.place, r.prizeUsd]));

  // Rungs are consumed by eligible entrants in finishing order. `place` walks
  // the ladder independently of `rank`, so an ineligible entrant sitting above
  // an eligible one does not burn a rung.
  let place = 0;
  const ranked: RankedEntrant[] = scored.map((e, i) => {
    const eligible = isPrizeEligible(e.score, e.platformOperated);
    let prizeUsd = 0;
    if (eligible) {
      place += 1;
      prizeUsd = rungByPlace.get(place) ?? 0;
    }
    return { agentId: e.agentId, score: e.score, rank: i + 1, eligible, prizeUsd };
  });

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
