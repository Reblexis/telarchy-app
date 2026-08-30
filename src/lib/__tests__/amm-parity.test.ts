import { describe, expect, test } from 'vitest';
import { betTowardsValue, consensus, pHigher, sharesForBudget } from '../../../functions/src/lib/amm';
import { previewSell, previewTargetBet, previewTrade } from '../amm';

/**
 * Preview / execution parity: the ticket's client-side previews against
 * the REAL server AMM, executing the server's trade flow step by step
 * (services/trading.ts executeTradeInTx) on an absolute book.
 *
 * This is the test that was missing on 2026-08-22, when the "New value"
 * the ticket showed was not the value the market traded to: the server
 * had learned netting (a buy on the side opposite a held position first
 * sells that position, 2026-08-11) and the previews had not. The two
 * sides of the promise live in different source trees, so only a test
 * that imports both can hold them together. If server trade semantics
 * change again, this file is what fails.
 *
 * The preview receives only what the ticket receives: the market's live
 * probability, liquidity, range, and the trader's held position. The
 * server mirror executes on the absolute share book those came from.
 */

const B = 100;
const MIN = 0;
const MAX = 1000;

type Book = [number, number];

/** Server-side execution of a {direction, amount} buy, redemption included
    (executeTradeInTx: buy against the live book, then cash matched pairs).
    Redemption takes the same amount off BOTH sides, so it never moves the
    landed price; it only pays credits. */
function serverBuy(
  book: Book,
  held: { direction: 'higher' | 'lower'; shares: number } | null,
  direction: 'higher' | 'lower',
  amount: number,
): { landedProb: number; shares: number; redeemed: number } {
  const dirIdx = direction === 'higher' ? 1 : 0;
  const r = sharesForBudget(book, dirIdx as 0 | 1, amount, B);
  let b2: Book = [book[0], book[1]];
  b2[dirIdx] += r.amount;
  let redeemed = 0;
  if (held && held.shares > 0 && held.direction !== direction) {
    redeemed = Math.min(held.shares, r.amount);
    b2 = [b2[0] - redeemed, b2[1] - redeemed];
  }
  return { landedProb: pHigher(b2, B), shares: r.amount, redeemed };
}

/** Server-side execution of a {targetValue, maxBudget} trade, netting
    included: the route picks the buy side against the live consensus,
    executeTradeInTx nets against it, betTowardsValue does the rest. */
function serverTargetTrade(
  book: Book,
  held: { direction: 'higher' | 'lower'; shares: number } | null,
  targetValue: number,
  maxBudget: number,
): { landedProb: number; direction: 'higher' | 'lower'; cost: number } {
  const c0 = consensus(book, B, MIN, MAX)!;
  // The buy side is picked against the live consensus, and betTowardsValue
  // runs on that same live book: redemption happens after, and moves no
  // price (it is symmetric on the two sides).
  void (targetValue >= c0 ? 1 : 0);
  let b2: Book = [book[0], book[1]];
  const r = betTowardsValue(b2, B, MIN, MAX, targetValue, maxBudget);
  b2 = [b2[0], b2[1]];
  b2[r.direction] += r.amount;
  return { landedProb: pHigher(b2, B), direction: r.direction === 1 ? 'higher' : 'lower', cost: r.cost };
}

const valueOf = (p: number) => MIN + p * (MAX - MIN);

describe('budget buys: preview lands where the server lands', () => {
  test('no held position (the pre-netting behaviour still holds)', () => {
    const book: Book = [0, 0];
    for (const dir of ['higher', 'lower'] as const) {
      for (const amount of [1, 25, 200]) {
        const server = serverBuy(book, null, dir, amount);
        const preview = previewTrade(pHigher(book, B), B, dir, amount, null);
        expect(valueOf(preview.newProb)).toBeCloseTo(valueOf(server.landedProb), 1);
        expect(preview.shares).toBeCloseTo(server.shares, 2);
      }
    }
  });

  test('held higher, buying lower: the bet moves the price, the position does not', () => {
    // The trader's own 50 higher shares ARE the book: the live price the
    // ticket sees (622.5) already contains them. Under redemption (owner
    // ask 2026-08-30) a 25-credit contrarian bet moves the price by 25
    // credits' worth and hands back a credit per matched pair. Under the
    // liquidation this replaced, the same bet dumped all 50 shares and
    // dragged the market from 622 to ~389.
    const book: Book = [0, 50];
    const held = { direction: 'higher' as const, shares: 50 };
    const server = serverBuy(book, held, 'lower', 25);
    const preview = previewTrade(pHigher(book, B), B, 'lower', 25, held);
    expect(valueOf(preview.newProb)).toBeCloseTo(valueOf(server.landedProb), 1);
    // Holding the opposite side changes the LANDING by nothing at all:
    // redemption is symmetric on the two sides, so it cancels out of the
    // price. It only pays credits.
    const noPosition = previewTrade(pHigher(book, B), B, 'lower', 25, null);
    expect(valueOf(preview.newProb)).toBeCloseTo(valueOf(noPosition.newProb), 6);
    expect(preview.redeemed).toBeGreaterThan(0);
    expect(noPosition.redeemed).toBe(0);
    // And the move is the bet's own, not the position's: the liquidation
    // this replaced landed ~389 on the same book and bet.
    expect(valueOf(preview.newProb)).toBeGreaterThan(450);
  });

  test('held lower, buying higher', () => {
    const book: Book = [80, 0];
    const held = { direction: 'lower' as const, shares: 80 };
    const server = serverBuy(book, held, 'higher', 40);
    const preview = previewTrade(pHigher(book, B), B, 'higher', 40, held);
    expect(valueOf(preview.newProb)).toBeCloseTo(valueOf(server.landedProb), 1);
  });

  test('buying the SAME side as the held position nets nothing', () => {
    const book: Book = [0, 50];
    const held = { direction: 'higher' as const, shares: 50 };
    const server = serverBuy(book, held, 'higher', 25);
    const preview = previewTrade(pHigher(book, B), B, 'higher', 25, held);
    expect(valueOf(preview.newProb)).toBeCloseTo(valueOf(server.landedProb), 1);
  });

  test('a grid of held sizes, sides and budgets stays in step', () => {
    for (const heldShares of [5, 30, 120]) {
      for (const heldDir of ['higher', 'lower'] as const) {
        const book: Book = heldDir === 'higher' ? [10, 10 + heldShares] : [10 + heldShares, 10];
        const held = { direction: heldDir, shares: heldShares };
        for (const dir of ['higher', 'lower'] as const) {
          for (const amount of [3, 60]) {
            const server = serverBuy(book, held, dir, amount);
            const preview = previewTrade(pHigher(book, B), B, dir, amount, held);
            expect(valueOf(preview.newProb)).toBeCloseTo(valueOf(server.landedProb), 1);
          }
        }
      }
    }
  });

  test('redeemed pairs match what the server cashes, at 1 credit each', () => {
    const book: Book = [0, 50];
    const held = { direction: 'higher' as const, shares: 50 };
    // Small bet: fewer shares bought than held (8 credits buys ~20 shares
    // on this book), so every bought share pairs off and the rest of the
    // position survives.
    const small = serverBuy(book, held, 'lower', 8);
    const smallPreview = previewTrade(pHigher(book, B), B, 'lower', 8, held);
    expect(smallPreview.redeemed).toBeCloseTo(small.redeemed, 6);
    expect(smallPreview.redeemed).toBeCloseTo(smallPreview.shares, 6);
    expect(smallPreview.redeemed).toBeLessThan(50);

    // Big bet: more shares bought than held, so the whole position pairs
    // off and the trader ends up net on the new side.
    const big = serverBuy(book, held, 'lower', 400);
    const bigPreview = previewTrade(pHigher(book, B), B, 'lower', 400, held);
    expect(bigPreview.redeemed).toBeCloseTo(big.redeemed, 6);
    expect(bigPreview.redeemed).toBeCloseTo(50, 6);

    // The "worth now" readout is a different question (what the AMM would
    // pay to sell into the book) and is deliberately lower than par.
    expect(previewSell(pHigher(book, B), B, 'higher', 50)).toBeLessThan(50);
  });
});

describe('target trades: preview lands where the server lands', () => {
  test('no held position, ample budget: both land ON the target', () => {
    const book: Book = [0, 0];
    const server = serverTargetTrade(book, null, 700, 1e9);
    const preview = previewTargetBet(pHigher(book, B), B, MIN, MAX, 700, 1e9, null)!;
    expect(valueOf(server.landedProb)).toBeCloseTo(700, 1);
    expect(valueOf(preview.newProb)).toBeCloseTo(700, 1);
    expect(preview.direction).toBe(server.direction);
    expect(preview.cost).toBeCloseTo(server.cost, 1);
  });

  test('held higher, target below the price: nets first, then buys, lands on target', () => {
    const book: Book = [0, 50];
    const held = { direction: 'higher' as const, shares: 50 };
    const server = serverTargetTrade(book, held, 400, 1e9);
    const preview = previewTargetBet(pHigher(book, B), B, MIN, MAX, 400, 1e9, held)!;
    expect(valueOf(server.landedProb)).toBeCloseTo(400, 1);
    expect(valueOf(preview.newProb)).toBeCloseTo(400, 1);
    expect(preview.cost).toBeCloseTo(server.cost, 1);
  });

  test('a target below the live price simply buys lower, held position or not', () => {
    // Live 622 (held higher), target 550. Under the liquidation this
    // replaced, the forced close dropped the price to 500 first and the
    // trade then bought HIGHER back up to 550, which is the buyback case
    // the preview had to model. Redemption moves no price, so the target
    // is reached the obvious way: buy lower down to it.
    const book: Book = [0, 50];
    const held = { direction: 'higher' as const, shares: 50 };
    const server = serverTargetTrade(book, held, 550, 1e9);
    const preview = previewTargetBet(pHigher(book, B), B, MIN, MAX, 550, 1e9, held)!;
    expect(server.direction).toBe('lower');
    expect(preview.direction).toBe('lower');
    expect(valueOf(server.landedProb)).toBeCloseTo(550, 1);
    expect(valueOf(preview.newProb)).toBeCloseTo(550, 1);
    expect(preview.cost).toBeCloseTo(server.cost, 1);
  });

  test('budget-capped: both spend the budget and stop at the same short landing', () => {
    const book: Book = [0, 50];
    const held = { direction: 'higher' as const, shares: 50 };
    const server = serverTargetTrade(book, held, 100, 10);
    const preview = previewTargetBet(pHigher(book, B), B, MIN, MAX, 100, 10, held)!;
    expect(valueOf(server.landedProb)).toBeGreaterThan(100); // fell short
    expect(valueOf(preview.newProb)).toBeCloseTo(valueOf(server.landedProb), 1);
    expect(preview.cost).toBeCloseTo(server.cost, 1);
  });
});

describe('what the ticket actually receives survives the API rounding', () => {
  test('the 4-decimal probability the markets endpoint serves keeps the preview honest', () => {
    // getMarkets rounds probability to 4 decimals; on a 0..1000 range that
    // is at most 0.05 of drift. The preview from the rounded prob must
    // stay within a display-rounding of the server landing.
    const book: Book = [0, 50];
    const held = { direction: 'higher' as const, shares: 50 };
    const rounded = Math.round(pHigher(book, B) * 10000) / 10000;
    const server = serverBuy(book, held, 'lower', 25);
    const preview = previewTrade(rounded, B, 'lower', 25, held);
    expect(Math.abs(valueOf(preview.newProb) - valueOf(server.landedProb))).toBeLessThan(0.5);
  });
});
