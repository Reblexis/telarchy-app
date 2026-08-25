import { describe, expect, test } from 'vitest';
import {
  betTowardsValue,
  consensus,
  directionSellProceeds,
  pHigher,
  sharesForBudget,
} from '../../../functions/src/lib/amm';
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

/** Server-side execution of a {direction, amount} buy, netting included. */
function serverBuy(
  book: Book,
  held: { direction: 'higher' | 'lower'; shares: number } | null,
  direction: 'higher' | 'lower',
  amount: number,
): { landedProb: number; shares: number; nettingProceeds: number } {
  let b2: Book = [book[0], book[1]];
  let proceeds = 0;
  if (held && held.shares > 0 && held.direction !== direction) {
    const idx = held.direction === 'higher' ? 1 : 0;
    proceeds = directionSellProceeds(b2, idx as 0 | 1, held.shares, B);
    b2 = [b2[0], b2[1]];
    b2[idx] -= held.shares;
  }
  const dirIdx = direction === 'higher' ? 1 : 0;
  const r = sharesForBudget(b2, dirIdx as 0 | 1, amount, B);
  b2 = [b2[0], b2[1]];
  b2[dirIdx] += r.amount;
  return { landedProb: pHigher(b2, B), shares: r.amount, nettingProceeds: proceeds };
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
  const buyDir: 0 | 1 = targetValue >= c0 ? 1 : 0;
  let b2: Book = [book[0], book[1]];
  if (held && held.shares > 0 && (held.direction === 'higher' ? 1 : 0) !== buyDir) {
    const idx = held.direction === 'higher' ? 1 : 0;
    b2 = [b2[0], b2[1]];
    b2[idx] -= held.shares;
  }
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

  test('held higher, buying lower: the netting close moves the start (the 2026-08-22 bug)', () => {
    // The trader's own 50 higher shares ARE the book: the live price the
    // ticket sees (622.5) already contains them. Before the fix the
    // preview said ~485 while the server landed ~389.
    const book: Book = [0, 50];
    const held = { direction: 'higher' as const, shares: 50 };
    const server = serverBuy(book, held, 'lower', 25);
    const preview = previewTrade(pHigher(book, B), B, 'lower', 25, held);
    expect(valueOf(preview.newProb)).toBeCloseTo(valueOf(server.landedProb), 1);
    // And the old (netting-blind) preview really was wrong, by a lot:
    const blind = previewTrade(pHigher(book, B), B, 'lower', 25, null);
    expect(Math.abs(valueOf(blind.newProb) - valueOf(server.landedProb))).toBeGreaterThan(50);
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

  test('netting proceeds match what the server pays for the close', () => {
    const book: Book = [0, 50];
    const held = { direction: 'higher' as const, shares: 50 };
    const server = serverBuy(book, held, 'lower', 25);
    const preview = previewTrade(pHigher(book, B), B, 'lower', 25, held);
    expect(preview.nettingProceeds).toBeCloseTo(server.nettingProceeds, 1);
    // previewSell (the "worth now" readout) is the same number.
    expect(previewSell(pHigher(book, B), B, 'higher', 50)).toBeCloseTo(server.nettingProceeds, 1);
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

  test('the buyback case: target between the netted price and the live price flips the final side', () => {
    // Live 622 (held higher). Target 550: the route sells the higher
    // position (price falls to 500), then betTowardsValue buys HIGHER
    // back up to 550. A naive "550 < 622, buy lower" model gets both the
    // side and the landing wrong.
    const book: Book = [0, 50];
    const held = { direction: 'higher' as const, shares: 50 };
    const server = serverTargetTrade(book, held, 550, 1e9);
    const preview = previewTargetBet(pHigher(book, B), B, MIN, MAX, 550, 1e9, held)!;
    expect(server.direction).toBe('higher');
    expect(preview.direction).toBe('higher');
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
