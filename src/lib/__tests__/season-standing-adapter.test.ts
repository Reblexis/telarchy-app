import { describe, expect, test } from 'vitest';
import type { SeasonStanding } from '../api';
import { seasonStandingToEntry } from '../api';

/**
 * The adapter that lets the trader rail and /leaderboard render a running
 * season's standings through the same row they already use for the all-time
 * board (owner decision 2026-08-22: the floor becomes the season board). The
 * mapping is the contract: get a field wrong and the season board silently
 * shows a lifetime number, a missing prize, or drops every row.
 */
describe('seasonStandingToEntry', () => {
  const standing = (o: Partial<SeasonStanding>): SeasonStanding => ({
    rank: 1,
    id: 'a',
    nickname: 'kai',
    image: null,
    manifoldUsername: null,
    score: 0,
    projectedPrizeUsd: 0,
    ...o,
  });

  test('the season SCORE takes the slot the row prints as the number', () => {
    // Not the lifetime totalEarnings: the whole point is to show growth since
    // baseline, so a positive lifetime trader at season score 0 reads as 0.
    expect(seasonStandingToEntry(standing({ score: 37 })).totalEarnings).toBe(37);
    expect(seasonStandingToEntry(standing({ score: -8 })).totalEarnings).toBe(-8);
    expect(seasonStandingToEntry(standing({ score: null })).totalEarnings).toBe(0);
  });

  test('the projected payout takes the prize slot', () => {
    expect(seasonStandingToEntry(standing({ projectedPrizeUsd: 500 })).seasonPrizeUsd).toBe(500);
    expect(seasonStandingToEntry(standing({ projectedPrizeUsd: 0 })).seasonPrizeUsd).toBe(0);
  });

  test('every standing is marked entered with a surviving trade count', () => {
    // seasonEntered gates the prize chip; totalTrades > 0 is what keeps the row
    // past the rail/leaderboard "drop never-traded" filter. An entrant who has
    // not traded still belongs on the season board.
    const e = seasonStandingToEntry(standing({ score: 0 }));
    expect(e.seasonEntered).toBe(true);
    expect(e.totalTrades).toBeGreaterThan(0);
  });

  test('rank, identity and Manifold badge carry through', () => {
    const e = seasonStandingToEntry(
      standing({ rank: 3, id: 'z', nickname: 'ada', manifoldUsername: 'ada_m', image: 'http://x/a.png' }),
    );
    expect([e.rank, e.id, e.nickname, e.manifoldUsername, e.image]).toEqual([3, 'z', 'ada', 'ada_m', 'http://x/a.png']);
  });
});
