import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * THE RULE: the optimistic price from your own trade expires when the server's
 * next payload arrives, and every surface that prices the market reads the
 * same probability.
 *
 * `livePrice` is written in exactly one place, after your own trade lands, so
 * the headline moves before the reload does. Nothing cleared it. It is keyed
 * by market, so leaving the market dropped it, but STAYING did not: the
 * headline number, both side ceilings and the position card's "Worth now" and
 * "Profit" all sat at the price YOUR trade landed at for as long as you stayed
 * there, while the chart line, the pool and the volume beside them moved with
 * the market. A trader could sell on an hour-old number that was theirs alone
 * (bug hunt 2026-08-31).
 *
 * The second half: `TradeTicket` took `active.probability` (fresh) while
 * `PositionSummary` directly under it took `livePriceProb ?? active.probability`
 * (frozen), so one screen printed two values for one position.
 *
 * These are structural facts about a 2,700-line component that a render test
 * cannot pin without standing up the whole floor, so they are asserted
 * against the source. Both fail if the lines come back.
 */

const SRC = readFileSync(join(__dirname, '..', 'TradePage.tsx'), 'utf8');

describe('the optimistic price expires', () => {
  test('a landed payload clears livePrice', () => {
    expect(SRC).toContain('setLivePrice(null)');
  });

  test('livePrice is cleared inside the reload, not somewhere a trade can skip', () => {
    const reload = SRC.slice(SRC.indexOf('const reload = ()'), SRC.indexOf('useEffect(reload'));
    expect(reload).toContain('setLivePrice(null)');
  });
});

describe('one probability prices the market', () => {
  test('the probability is derived once and passed, not re-derived per surface', () => {
    // Exactly one place folds the optimistic price into the shown one.
    expect(SRC.match(/livePriceProb \?\? active\.probability/g)?.length).toBe(1);
    // And both surfaces that price a position take that one value.
    expect(SRC.match(/probability=\{shownProbability\}/g)?.length).toBe(2);
  });

  test('the ceilings read it too', () => {
    expect(SRC).toContain('maxWinLabel(shownProbability');
    expect(SRC).toContain('maxWinLabel(1 - shownProbability');
  });
});
