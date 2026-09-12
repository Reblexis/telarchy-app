import { describe, expect, test } from 'vitest';
import { guardLimit, pushesCallUp } from '../price-guard';

/**
 * The ticket's default price guard (docs/ui-conventions.md, "The ticket
 * guards the price by default"): the call the ticket's own quote says the
 * trade lands on, widened by 2% of the book's range against the trader.
 * The direction rule mirrors the server's (functions/src/lib/amm.ts
 * boundSide): a limit is a ceiling for a trade that pushes the call up.
 */

describe('which way a trade pushes the call', () => {
  test('buying higher pushes it up', () => expect(pushesCallUp('buy', 'higher')).toBe(true));
  test('buying lower pushes it down', () => expect(pushesCallUp('buy', 'lower')).toBe(false));
  test('selling higher pushes it down', () => expect(pushesCallUp('sell', 'higher')).toBe(false));
  test('selling lower pushes it up', () => expect(pushesCallUp('sell', 'lower')).toBe(true));
});

describe("THE TICKET'S LIMIT IS ITS OWN QUOTE WIDENED BY 2% OF THE RANGE AGAINST THE TRADER", () => {
  test('a trade that pushes the call up may land up to 2% of the range above its quote', () => {
    expect(guardLimit({ quote: 60, rangeMin: 0, rangeMax: 100, pushesUp: true })).toBeCloseTo(62, 9);
  });

  test('a trade that pushes the call down may land up to 2% of the range below its quote', () => {
    expect(guardLimit({ quote: 60, rangeMin: 0, rangeMax: 100, pushesUp: false })).toBeCloseTo(58, 9);
  });

  test('2% of the range, not of the price: a wide book widens by its own span', () => {
    expect(guardLimit({ quote: 50_000, rangeMin: 0, rangeMax: 500_000, pushesUp: true })).toBeCloseTo(60_000, 6);
    expect(guardLimit({ quote: 150, rangeMin: 100, rangeMax: 200, pushesUp: false })).toBeCloseTo(148, 9);
  });

  test('no range to widen by, no limit', () => {
    expect(guardLimit({ quote: 60, rangeMin: 100, rangeMax: 100, pushesUp: true })).toBeNull();
    expect(guardLimit({ quote: Number.NaN, rangeMin: 0, rangeMax: 100, pushesUp: true })).toBeNull();
  });
});
