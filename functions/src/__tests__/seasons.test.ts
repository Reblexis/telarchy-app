import {
  claimDeadline,
  isOpenForEntry,
  isPrizeEligible,
  ladderTotal,
  seasonScore,
  settleSeason,
  type LadderRung,
  type SeasonEntrant,
} from '../lib/seasons';

/**
 * The prize-season rules, tested without a database because every one of them
 * is arithmetic and a pure test that runs in a millisecond has no excuse to be
 * skipped. The database-shaped rules (settle only from running, claim windows,
 * payment details never leaking) live in season-lifecycle.test.ts.
 *
 * Season 1's published ladder, used throughout: $1,000 pool, top five, $50
 * floor. The numbers are the owner's, from the design doc of 2026-08-17.
 */
const LADDER: LadderRung[] = [
  { place: 1, prizeUsd: 500 },
  { place: 2, prizeUsd: 250 },
  { place: 3, prizeUsd: 125 },
  { place: 4, prizeUsd: 75 },
  { place: 5, prizeUsd: 50 },
];
const POOL = 1000;

const T0 = new Date('2026-09-01T00:00:00Z');
function entrant(agentId: string, baseline: number, current: number, enteredMsAfterT0 = 0): SeasonEntrant {
  return { agentId, baselineProfit: baseline, currentProfit: current, enteredAt: new Date(T0.getTime() + enteredMsAfterT0) };
}

describe('seasonScore', () => {
  test('is the growth in profit across the window, not the profit itself', () => {
    // The whole point of a baseline: someone who arrived already up 400 and
    // ended up 410 earned 10 this season, not 410.
    expect(seasonScore(410, 400)).toBe(10);
  });

  test('a losing season scores negative, and is not clamped', () => {
    // The standings should show it. Clamping to zero would make every loser
    // tie with every idle entrant.
    expect(seasonScore(300, 500)).toBe(-200);
  });

  test('an absent baseline reads as zero, so a newcomer keeps everything earned', () => {
    // The route stores no row for a participant with no profit at season
    // start, and passes 0 here. A brand new account is scored on exactly what
    // it made inside the window.
    expect(seasonScore(87.5, 0)).toBe(87.5);
  });

  test('rounds to 2dp, because subtracting two 2dp floats is not 2dp', () => {
    // 441.51 - 13.57 is 427.94000000000005 in IEEE 754. Unrounded, that is
    // what a public standings board would print.
    expect(seasonScore(441.51, 13.57)).toBe(427.94);
    expect(String(seasonScore(441.51, 13.57))).toBe('427.94');
  });
});

describe('isPrizeEligible', () => {
  test('exactly zero is not eligible', () => {
    // Five of the eleven participants on the production board sat at exactly
    // 0 when this was designed. Without this rule a season in which nobody
    // moved still pays out $950, ordered by a tiebreak.
    expect(isPrizeEligible(0)).toBe(false);
  });

  test('a loss is not eligible', () => {
    expect(isPrizeEligible(-0.01)).toBe(false);
  });

  test('any gain is eligible', () => {
    expect(isPrizeEligible(0.01)).toBe(true);
  });
});

describe('settleSeason', () => {
  test('assigns the ladder in score order and rolls nothing when full', () => {
    const result = settleSeason([
      entrant('e', 0, 10),
      entrant('a', 0, 500),
      entrant('c', 0, 100),
      entrant('b', 0, 250),
      entrant('d', 0, 50),
    ], LADDER, POOL);

    expect(result.ranked.map(r => r.agentId)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(result.ranked.map(r => r.prizeUsd)).toEqual([500, 250, 125, 75, 50]);
    expect(result.rolloverUsd).toBe(0);
  });

  test('fewer eligible entrants than rungs leaves the lower rungs unpaid and rolls them', () => {
    const result = settleSeason([
      entrant('a', 0, 300),
      entrant('b', 0, 100),
    ], LADDER, POOL);

    expect(result.ranked.map(r => r.prizeUsd)).toEqual([500, 250]);
    // 1000 - 750. Places 3, 4 and 5 were promised to nobody.
    expect(result.rolloverUsd).toBe(250);
  });

  test('entrants at exactly zero are ranked but paid nothing', () => {
    // They still appear in the standings, in order; they just do not collect.
    const result = settleSeason([
      entrant('a', 0, 25),
      entrant('b', 100, 100),
      entrant('c', 100, 100),
    ], LADDER, POOL);

    expect(result.ranked.map(r => r.rank)).toEqual([1, 2, 3]);
    expect(result.ranked.map(r => r.eligible)).toEqual([true, false, false]);
    expect(result.ranked.map(r => r.prizeUsd)).toEqual([500, 0, 0]);
    expect(result.rolloverUsd).toBe(500);
  });

  test('a season where nobody made anything pays out nothing at all', () => {
    // The correct answer to "nobody earned anything" is not "$950 anyway".
    const result = settleSeason([
      entrant('a', 0, 0),
      entrant('b', 50, 20),
      entrant('c', 0, 0),
    ], LADDER, POOL);

    expect(result.ranked.every(r => r.prizeUsd === 0)).toBe(true);
    expect(result.rolloverUsd).toBe(POOL);
  });

  test('an ineligible entrant above an eligible one does not burn a rung', () => {
    // 'loser' outranks nobody on score, but a naive implementation that maps
    // rank straight onto ladder place would hand 'winner' second prize.
    const result = settleSeason([
      entrant('winner', 0, 10),
      entrant('loser', 0, -5),
    ], LADDER, POOL);

    const winner = result.ranked.find(r => r.agentId === 'winner')!;
    const loser = result.ranked.find(r => r.agentId === 'loser')!;
    expect(winner.rank).toBe(1);
    expect(winner.prizeUsd).toBe(500);
    expect(loser.prizeUsd).toBe(0);
  });

  test('ties break by earlier entry, then by agent id, deterministically', () => {
    // A cash ladder cannot break a tie by whatever order the database
    // returned. 'late' entered a second after 'early' on the same score.
    const result = settleSeason([
      entrant('late', 0, 100, 1000),
      entrant('early', 0, 100, 0),
    ], LADDER, POOL);
    expect(result.ranked.map(r => r.agentId)).toEqual(['early', 'late']);
    expect(result.ranked.map(r => r.prizeUsd)).toEqual([500, 250]);
  });

  test('a tie at the same instant breaks by agent id, so a rerun agrees', () => {
    const args = () => [entrant('zeta', 0, 100), entrant('alpha', 0, 100)];
    const first = settleSeason(args(), LADDER, POOL);
    const second = settleSeason(args().reverse(), LADDER, POOL);
    expect(first.ranked.map(r => r.agentId)).toEqual(['alpha', 'zeta']);
    expect(second.ranked.map(r => r.agentId)).toEqual(first.ranked.map(r => r.agentId));
  });

  test('scores are computed from the baseline, so the biggest balance need not win', () => {
    // 'whale' is far richer in absolute profit but earned less this season.
    // Ranking on raw profit rather than the delta would invert this.
    const result = settleSeason([
      entrant('whale', 1000, 1010),
      entrant('sharp', 0, 90),
    ], LADDER, POOL);
    expect(result.ranked[0].agentId).toBe('sharp');
    expect(result.ranked[0].score).toBe(90);
    expect(result.ranked[1].score).toBe(10);
  });

  test('no entrants at all rolls the whole pool and crashes nothing', () => {
    const result = settleSeason([], LADDER, POOL);
    expect(result.ranked).toEqual([]);
    expect(result.rolloverUsd).toBe(POOL);
  });

  test('rollover is exact to the cent on an odd ladder', () => {
    const odd: LadderRung[] = [{ place: 1, prizeUsd: 333.33 }, { place: 2, prizeUsd: 333.33 }];
    const result = settleSeason([entrant('a', 0, 5), entrant('b', 0, 4)], odd, 1000);
    expect(result.rolloverUsd).toBe(333.34);
  });
});

describe('ladderTotal', () => {
  test('sums the rungs, which is what a season is validated against', () => {
    expect(ladderTotal(LADDER)).toBe(1000);
  });

  test('is exact on cents', () => {
    expect(ladderTotal([{ place: 1, prizeUsd: 0.1 }, { place: 2, prizeUsd: 0.2 }])).toBe(0.3);
  });
});

describe('isOpenForEntry', () => {
  const ends = new Date('2026-09-30T00:00:00Z');
  const during = new Date('2026-09-15T00:00:00Z');

  test('a running season accepts entries until it ends', () => {
    expect(isOpenForEntry('running', during, ends)).toBe(true);
  });

  test('a draft season accepts them too, so people can sign up before it starts', () => {
    // Changed 2026-08-18 (owner direction). Entry used to require `running`,
    // which meant the announcement, the countdown and the button could not
    // exist until the start instant: everyone who heard about the season early
    // had to be told to come back. Pre-registering is safe because the baseline
    // is read for EVERYONE at the start instant, not at opt-in, so it confers
    // no starting-point advantage.
    expect(isOpenForEntry('draft', during, ends)).toBe(true);
    // Including before the start instant, which is the whole point.
    expect(isOpenForEntry('draft', new Date('2026-08-01T00:00:00Z'), ends)).toBe(true);
  });

  test('a settled season does not', () => {
    expect(isOpenForEntry('settled', during, ends)).toBe(false);
  });

  test('entry closes at the end instant, not after settlement', () => {
    expect(isOpenForEntry('running', new Date('2026-10-01T00:00:00Z'), ends)).toBe(false);
  });
});

describe('claimDeadline', () => {
  test('is 30 days after settlement, the window published in the rules', () => {
    expect(claimDeadline(new Date('2026-09-30T00:00:00Z')).toISOString())
      .toBe('2026-10-30T00:00:00.000Z');
  });
});
