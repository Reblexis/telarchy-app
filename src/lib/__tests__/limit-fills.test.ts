import { describe, expect, test } from 'vitest';
import {
  betTowardsValue,
  directionSellProceeds,
  directionTradeCost,
  lmsrCost,
  pHigher,
  sharesForBudget,
  sharesToBound,
} from '../../../functions/src/lib/amm';
import { type RestingOrder, settleThroughOrders } from '../limit-fills';

/**
 * Where the price comes to rest after the resting orders a trade crosses
 * (docs/limit-orders.md, "A quote lands where the price comes to rest").
 *
 * The ticket's landing used to be the trade's own move on the curve, while
 * the server runs the fill pass in the same transaction and the book rests
 * somewhere else. These pin the simulator the ticket now runs to the pass's
 * rules; functions/src/__tests__/landing-parity.test.ts pins it to the real
 * server end to end.
 */

const B = 200;
const MIN = 0;
const MAX = 100;

const logit = (p: number) => Math.log(p / (1 - p));
const priceOf = (p: number) => MIN + p * (MAX - MIN);

function order(over: Partial<RestingOrder>): RestingOrder {
  return {
    id: 'o-1',
    side: 'buy',
    direction: 'higher',
    limitValue: 45,
    left: 1000,
    holder: 0,
    held: { higher: 0, lower: 0 },
    ...over,
  };
}

const settle = (prob: number, orders: RestingOrder[], extra: Partial<Parameters<typeof settleThroughOrders>[0]> = {}) =>
  settleThroughOrders({ prob, liquidity: B, rangeMin: MIN, rangeMax: MAX, orders, ...extra });

describe('the price at rest', () => {
  test('with no resting orders it is the trade’s own landing', () => {
    expect(settle(0.4, [])).toBe(0.4);
  });

  test('A BUY PULLED BACK BY A RESTING ORDER RESTS AT THAT ORDER’S LIMIT', () => {
    // The trade took the call to 40; a higher buy waiting at 45 or below buys
    // it back up to 45 and no further.
    expect(priceOf(settle(0.4, [order({ limitValue: 45 })]))).toBeCloseTo(45, 2);
  });

  test('a lower buy waiting above pulls a rise back down to its limit', () => {
    const orders = [order({ direction: 'lower', limitValue: 55 })];
    expect(priceOf(settle(0.6, orders))).toBeCloseTo(55, 2);
  });

  test('an order whose budget cannot reach its limit spends it all and the price rests short of it', () => {
    const book: [number, number] = [0, B * logit(0.4)];
    const r = sharesForBudget(book, 1, 1, B);
    const expected = pHigher([book[0], book[1] + r.amount], B);
    const rest = settle(0.4, [order({ limitValue: 45, left: 1 })]);
    expect(rest).toBeCloseTo(expected, 9);
    expect(priceOf(rest)).toBeGreaterThan(40);
    expect(priceOf(rest)).toBeLessThan(45);
  });

  test('an order the price has not reached changes nothing', () => {
    expect(settle(0.4, [order({ limitValue: 35 })])).toBe(0.4);
  });

  test('an order past its expiry changes nothing', () => {
    const orders = [order({ limitValue: 45, expiresAt: '2026-09-14T10:00:00.000Z' })];
    expect(settle(0.4, orders, { now: Date.parse('2026-09-14T10:00:01.000Z') })).toBe(0.4);
    expect(priceOf(settle(0.4, orders, { now: Date.parse('2026-09-14T09:59:59.000Z') }))).toBeCloseTo(45, 2);
  });

  test('an order already spent changes nothing', () => {
    expect(settle(0.4, [order({ limitValue: 45, left: 0.005 })])).toBe(0.4);
  });
});

describe('sells', () => {
  test('a higher sell waiting above sells a rise back down to its limit', () => {
    const orders = [
      order({ side: 'sell', direction: 'higher', limitValue: 55, left: 5000, held: { higher: 5000, lower: 0 } }),
    ];
    expect(priceOf(settle(0.6, orders))).toBeCloseTo(55, 2);
  });

  test('A SELL NEVER SELLS MORE THAN ITS HOLDER HOLDS', () => {
    const book: [number, number] = [0, B * logit(0.6)];
    const orders = [
      order({ side: 'sell', direction: 'higher', limitValue: 55, left: 5000, held: { higher: 2, lower: 0 } }),
    ];
    const expected = pHigher([book[0], book[1] - 2], B);
    expect(settle(0.6, orders)).toBeCloseTo(expected, 9);
  });

  test('a sell whose holder holds nothing changes nothing', () => {
    const orders = [order({ side: 'sell', direction: 'higher', limitValue: 55, left: 5000 })];
    expect(settle(0.6, orders)).toBe(0.6);
  });

  test('a lower sell waiting below sells a fall back up to its limit', () => {
    const orders = [
      order({ side: 'sell', direction: 'lower', limitValue: 45, left: 5000, held: { higher: 0, lower: 5000 } }),
    ];
    expect(priceOf(settle(0.4, orders))).toBeCloseTo(45, 2);
  });
});

describe('the order the pass takes', () => {
  test('the order the price passed furthest fills first', () => {
    // At 40, the 45 order is deeper: it spends its 1 cr first, then the 42
    // order takes the price to 42 and no further. The other way round would
    // rest above 42.
    const orders = [
      order({ id: 'near', limitValue: 42, left: 1000 }),
      order({ id: 'far', limitValue: 45, left: 1, holder: 1 }),
    ];
    expect(priceOf(settle(0.4, orders))).toBeCloseTo(42, 2);
  });

  test('orders on both sides: the price ends where the pass stops, inside both limits', () => {
    const orders = [
      order({ id: 'up', direction: 'higher', limitValue: 45, left: 3 }),
      order({ id: 'down', direction: 'lower', limitValue: 48, left: 1000, holder: 1 }),
    ];
    const rest = priceOf(settle(0.4, orders));
    expect(rest).toBeGreaterThan(40);
    expect(rest).toBeLessThanOrEqual(48.01);
  });
});

describe('opposing orders', () => {
  test('OPPOSING ORDERS REST WHERE TRADING BACK AND FORTH WOULD HAVE ENDED', () => {
    const orders = [
      // Budgets that last dozens of identical rounds between 45 and 56 and run
      // out so the survivor stops partway, so where the price ends depends on
      // counting the rounds exactly.
      order({ id: 'up', direction: 'higher', limitValue: 56, left: 715 }),
      order({ id: 'down', direction: 'lower', limitValue: 45, left: 700, holder: 1 }),
    ];
    const atOnce = settle(0.5, orders);
    const walked = settle(0.5, orders, { roundsAtOnce: false });
    expect(atOnce).toBeCloseTo(walked, 9);
    // Not at either limit: the last partial step decides it.
    expect(priceOf(atOnce)).toBeGreaterThan(45.5);
    expect(priceOf(atOnce)).toBeLessThan(55.5);
  });

  test("one participant's buy and sell pulling against each other rest where walking them would", () => {
    const orders = [
      order({ id: 'buy', direction: 'higher', limitValue: 52, left: 2000, held: { higher: 30, lower: 0 } }),
      order({
        id: 'sell',
        side: 'sell',
        direction: 'higher',
        limitValue: 48,
        left: 3000,
        held: { higher: 30, lower: 0 },
      }),
    ];
    const atOnce = settle(0.5, orders);
    const walked = settle(0.5, orders, { roundsAtOnce: false });
    expect(atOnce).toBeCloseTo(walked, 9);
  });
});

describe("the trader's own orders", () => {
  test('a buy adds shares the trader’s own resting sell can then sell', () => {
    const own = order({ id: 'mine', side: 'sell', direction: 'higher', limitValue: 55, left: 1000, holder: 3 });
    expect(settle(0.6, [own])).toBe(0.6);
    const after = settle(0.6, [own], { heldChange: { orderIds: ['mine'], higher: 5000, lower: 0 } });
    expect(priceOf(after)).toBeCloseTo(55, 2);
  });

  test('a change for orders that are not in the list changes nobody', () => {
    const other = order({ id: 'theirs', side: 'sell', direction: 'higher', limitValue: 55, left: 1000 });
    expect(settle(0.6, [other], { heldChange: { orderIds: ['mine'], higher: 5000, lower: 0 } })).toBe(0.6);
  });
});

describe('the curve is the server’s', () => {
  // The simulator carries its own copy of the server's LMSR maths, because the
  // app bundle cannot import functions/. Every primitive is checked here.
  test('its primitives answer exactly as functions/src/lib/amm does', async () => {
    const mine = await import('../limit-fills');
    const books: [number, number][] = [
      [0, 0],
      [3.5, 40],
      [120, -7],
    ];
    for (const book of books) {
      for (const d of [0, 1] as const) {
        expect(mine.lmsrCost(book, B)).toBe(lmsrCost(book, B));
        expect(mine.directionTradeCost(book, d, 12.3, B)).toBe(directionTradeCost(book, d, 12.3, B));
        expect(mine.sharesForBudget(book, d, 7, B)).toEqual(sharesForBudget(book, d, 7, B));
        expect(mine.directionSellProceeds(book, d, 4.2, B)).toBe(directionSellProceeds(book, d, 4.2, B));
        expect(mine.betTowardsValue(book, B, MIN, MAX, 44.4, 50)).toEqual(betTowardsValue(book, B, MIN, MAX, 44.4, 50));
        for (const s of [true, false]) {
          expect(mine.sharesToBound(book, B, MIN, MAX, d, s, 47)).toBe(sharesToBound(book, B, MIN, MAX, d, s, 47));
        }
      }
    }
  });
});
