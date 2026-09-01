/**
 * THE RULE: a market belongs to a season when it SETTLES inside the season,
 * and a trade counts when it was made at least SEASON_TRADE_CUTOFF_HOURS
 * before the answer was fixed.
 *
 * Two instants, used by both halves of the board:
 *
 *   period end          = when the answer is fixed, and when trading stops
 *   period end + lag    = when the market settles and pays
 *
 * The two halves used to disagree about both. The marked (open) half decided
 * a market belonged to the season by its PERIOD END, so a market whose
 * reporting lag pushed settlement past `endsAt` was marked into "Total if
 * prices hold" and then dropped by the settled half, whose window keys on
 * `resolvedAt`. The column promised dollars the season structurally could not
 * pay, and its own tooltip says markets resolving after the season ends are
 * not counted (bug hunt 2026-08-31, P1-10).
 *
 * The cutoff those halves also disagreed about is gone entirely
 * (season-scores-what-you-held.test.ts): a market resolves on its reading, so
 * there is no window in which a visible answer can be traded against, which
 * is the only thing the cutoff protected.
 *
 * Owner decision 2026-09-01: "the season should end so it covers reasonable
 * reporting lags, and the reporting lag should be counted in it."
 */

import { seasonMarketCountsIn } from '../lib/board';
import { periodEndInstant, settlementInstantFor } from '../lib/date-utils';

const SEASON_END = new Date('2026-10-02T00:00:00Z');

/** September, three-day reporting lag: fixed 1 Oct, settles 4 Oct. */
const LAGGED = { targetDate: '2026-09', settlesAt: settlementInstantFor('2026-09', 4320) };
/** September, no lag: fixed and settled 1 Oct. */
const PROMPT = { targetDate: '2026-09', settlesAt: settlementInstantFor('2026-09', 0) };

describe('a market belongs to the season it settles in', () => {
  test('a market that settles inside the season counts', () => {
    expect(seasonMarketCountsIn(PROMPT, SEASON_END)).toBe(true);
  });

  test('a market whose lag pushes settlement past the end does NOT count', () => {
    // Fixed 1 Oct, inside the season. Settles 4 Oct, outside it. The old
    // marked half counted this and the settled half never could.
    expect(periodEndInstant(LAGGED.targetDate).getTime()).toBeLessThan(SEASON_END.getTime());
    expect(seasonMarketCountsIn(LAGGED, SEASON_END)).toBe(false);
  });

  test('a season long enough to cover the lag counts it again', () => {
    expect(seasonMarketCountsIn(LAGGED, new Date('2026-10-05T00:00:00Z'))).toBe(true);
  });

  test('a market with no settlesAt falls back to its period end', () => {
    expect(seasonMarketCountsIn({ targetDate: '2026-09', settlesAt: null }, SEASON_END)).toBe(true);
    expect(seasonMarketCountsIn({ targetDate: '2026-12', settlesAt: null }, SEASON_END)).toBe(false);
  });
});
