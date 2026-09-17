/**
 * TRADING CREDITS PUT INTO LIQUIDITY COUNT AS NEGATIVE PROFIT
 * (docs/seasons.md, "Trading credits put into liquidity are a position").
 *
 * Owner rule 2026-09-17, to stop gifting: until now a liquidity stake was
 * invisible to the score, so one account could fund a book from its trading
 * balance and a second account could trade the subsidy out, raising the
 * second score while the first never fell. The stake is now a cost when it
 * is paid and whatever it returns is proceeds when it lands, read off the
 * credit ledger. Liquidity-wallet credits write no ledger row and count as
 * nothing.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, creditLedger, liquidityEvents, markets, positions, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { loadBoard, loadSeasonMarked, loadSeasonSettled } from '../lib/board';
import { toUnits } from '../lib/validation';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-lp';
const OTHER_WS = 'ws-lp-other';
const GIVER = 'giver';
const TAKER = 'taker';
const START = new Date('2026-09-01T00:00:00Z');
const END = new Date('2026-10-01T00:00:00Z');
const IN = new Date('2026-09-10T00:00:00Z');
const BEFORE = new Date('2026-08-20T00:00:00Z');
const RESOLVED_AT = new Date('2026-09-13T03:40:00Z');

let seq = 0;
function ledger(agentId: string, credits: number, reason: string, at: Date, workspaceId = WS, refId = 'm-gift') {
  seq += 1;
  return db.insert(creditLedger).values({
    id: `lp-ledger-${seq}`,
    workspaceId,
    agentId,
    deltaUnits: toUnits(credits),
    balanceAfterUnits: toUnits(0),
    reason,
    refType: reason === 'proposal_stake' ? 'proposal' : 'market',
    refId,
    createdAt: at,
  } as typeof creditLedger.$inferInsert);
}

beforeAll(async () => {
  await ensureMigrations();
});

beforeEach(async () => {
  await truncateAll();
  await db.insert(workspaces).values([
    { id: WS, name: 'LP', createdBy: 'owner', visibility: 'public' },
    { id: OTHER_WS, name: 'Other', createdBy: 'owner', visibility: 'public' },
  ]);
  await db.insert(agents).values([
    { id: GIVER, apiKeyHash: 'h-giver', balance: 0 },
    { id: TAKER, apiKeyHash: 'h-taker', balance: 0 },
  ]);
  await db.insert(markets).values({
    id: 'm-gift',
    workspaceId: WS,
    metricId: 'metric',
    metricName: 'Number',
    targetDate: '2026-09-13T03:56',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0] as [number, number],
    liquidity: 10,
    pool: initialPool(10),
    active: false,
    resolved: true,
    actualValue: 60,
    resolvedAt: RESOLVED_AT,
    voided: false,
    tradedVolume: 10,
  });
  // The taker holds 10 higher bought for 2; resolved at 60 of [0, 100] pays 6: +4.
  await db.insert(positions).values({
    id: 'p-taker',
    agentId: TAKER,
    workspaceId: WS,
    marketId: 'm-gift',
    direction: 'higher',
    shares: 10,
    totalCost: 2,
  });
  await db.insert(trades).values({
    id: 't-taker',
    agentId: TAKER,
    workspaceId: WS,
    marketId: 'm-gift',
    direction: 'higher',
    shares: 10,
    cost: 2,
    createdAt: IN,
  });
});

describe('TRADING CREDITS PUT INTO LIQUIDITY COUNT AS NEGATIVE PROFIT', () => {
  test('a stake paid from the trading balance lowers the all-time board by what was paid', async () => {
    await ledger(GIVER, -100, 'liquidity', IN);
    const board = await loadBoard([WS]);
    expect(board.profitById.get(GIVER)).toBeCloseTo(-100, 6);
  });

  test('what the stake returns is proceeds: leftover 96 of a 100 stake leaves -4', async () => {
    await ledger(GIVER, -100, 'liquidity', IN);
    await ledger(GIVER, 96, 'lp_leftover', RESOLVED_AT);
    const b = (await loadBoard([WS])).breakdownById.get(GIVER)!;
    expect(b.total).toBeCloseTo(-4, 6);
    expect(b.settled).toBeCloseTo(-4, 6);
    expect(b.total).toBeCloseTo(b.settled + b.open, 6);
  });

  test('A GIFT THROUGH A BOOK CANNOT RAISE THE PAIR: the taker gains 4, the giver loses 4, the sum is zero', async () => {
    await ledger(GIVER, -100, 'liquidity', IN);
    await ledger(GIVER, 96, 'lp_leftover', RESOLVED_AT);
    const board = await loadBoard([WS]);
    const pair = (board.profitById.get(GIVER) ?? 0) + (board.profitById.get(TAKER) ?? 0);
    expect(board.profitById.get(TAKER)).toBeCloseTo(4, 6);
    expect(pair).toBeCloseTo(0, 6);
  });

  test("an owner's buy-out of a proposer's stake is a cost to the owner and proceeds to the proposer", async () => {
    await ledger(GIVER, -50, 'liquidity', IN, WS, 'prop-1');
    await ledger(GIVER, 50, 'proposal_stake', IN, WS, 'prop-1');
    await ledger(TAKER, -50, 'proposal_stake', IN, WS, 'prop-1');
    const board = await loadBoard([WS]);
    expect(board.profitById.get(GIVER) ?? 0).toBeCloseTo(0, 6);
    expect(board.profitById.get(TAKER)).toBeCloseTo(4 - 50, 6);
  });

  test('liquidity-wallet credits count as nothing: a funding event with no ledger row moves no score', async () => {
    await db.insert(liquidityEvents).values({
      id: 'le-wallet',
      workspaceId: WS,
      marketId: 'm-gift',
      agentId: GIVER,
      amount: 100,
      poolContribution: 100,
      totalLiquidity: 110,
      type: 'injection',
      fundedFrom: 'liquidity',
      createdAt: IN,
    });
    expect((await loadBoard([WS])).profitById.get(GIVER) ?? 0).toBe(0);
    expect((await loadSeasonSettled([WS], START, END)).get(GIVER) ?? 0).toBe(0);
  });

  test('a grant or a trade row is never read as liquidity', async () => {
    await ledger(GIVER, 1000, 'signup_grant', IN);
    await ledger(GIVER, -30, 'trade', IN);
    expect((await loadBoard([WS])).profitById.get(GIVER) ?? 0).toBe(0);
  });

  test('a stake counts only on a board whose workspace set holds the floor it was paid on', async () => {
    await ledger(GIVER, -100, 'liquidity', IN, OTHER_WS, 'm-elsewhere');
    expect((await loadBoard([WS])).profitById.get(GIVER) ?? 0).toBe(0);
    expect((await loadBoard([OTHER_WS])).profitById.get(GIVER)).toBeCloseTo(-100, 6);
  });

  test('a participant who only ever funded is on the board', async () => {
    await ledger(GIVER, -100, 'liquidity', IN);
    const board = await loadBoard([WS]);
    expect(board.profitById.has(GIVER)).toBe(true);
  });
});

describe('THE SEASON COUNTS IT AT THE INSTANT THE CREDITS MOVED', () => {
  test('a stake paid inside the window is a loss on the season score', async () => {
    await ledger(GIVER, -100, 'liquidity', IN);
    expect((await loadSeasonSettled([WS], START, END)).get(GIVER)).toBeCloseTo(-100, 6);
  });

  test('the gift nets to zero in the season too', async () => {
    await ledger(GIVER, -100, 'liquidity', IN);
    await ledger(GIVER, 96, 'lp_leftover', RESOLVED_AT);
    const s = await loadSeasonSettled([WS], START, END);
    expect((s.get(GIVER) ?? 0) + (s.get(TAKER) ?? 0)).toBeCloseTo(0, 6);
  });

  test('a stake paid before the season is not this season loss, and its leftover landing inside is this season proceeds', async () => {
    await ledger(GIVER, -100, 'liquidity', BEFORE);
    await ledger(GIVER, 96, 'lp_leftover', RESOLVED_AT);
    expect((await loadSeasonSettled([WS], START, END)).get(GIVER)).toBeCloseTo(96, 6);
  });

  test('the window is (start, end]: a row at the start instant is out, at the end instant is in', async () => {
    await ledger(GIVER, -10, 'liquidity', START);
    await ledger(GIVER, -7, 'liquidity', END);
    expect((await loadSeasonSettled([WS], START, END)).get(GIVER)).toBeCloseTo(-7, 6);
  });

  test('the marked column carries it as well, so the two halves never disagree', async () => {
    await ledger(GIVER, -100, 'liquidity', IN);
    expect((await loadSeasonMarked([WS], START, END)).get(GIVER)).toBeCloseTo(-100, 6);
  });

  test('a floor-only view counts the stake on its own floor and not on another', async () => {
    await ledger(GIVER, -100, 'liquidity', IN);
    expect((await loadSeasonSettled([WS], START, END, { floorOnly: true })).get(GIVER)).toBeCloseTo(-100, 6);
    expect((await loadSeasonSettled([OTHER_WS], START, END, { floorOnly: true })).get(GIVER) ?? 0).toBe(0);
  });
});

describe('A STAKE FROM THE TRADING BALANCE IS NOT CHARGED TWICE', () => {
  // The taker funds the book they then win 4 on. Paid from the balance, the
  // stake is already a cost, so the own-book rule leaves the 4 alone; paid
  // from the wallet, the own-book rule takes the 4 away as before.
  const fund = (fundedFrom: 'balance' | 'liquidity') =>
    db.insert(liquidityEvents).values({
      id: `le-${fundedFrom}`,
      workspaceId: WS,
      marketId: 'm-gift',
      agentId: TAKER,
      amount: 100,
      poolContribution: 100,
      totalLiquidity: 110,
      type: 'injection',
      fundedFrom,
      createdAt: IN,
    });

  test('balance-funded: -100 stake, +96 leftover, +4 won is zero, not minus four', async () => {
    await fund('balance');
    await ledger(TAKER, -100, 'liquidity', IN);
    await ledger(TAKER, 96, 'lp_leftover', RESOLVED_AT);
    expect((await loadSeasonSettled([WS], START, END)).get(TAKER) ?? 0).toBeCloseTo(0, 6);
  });

  test('wallet-funded: the own-book rule still takes the 4, and nothing else moves', async () => {
    await fund('liquidity');
    expect((await loadSeasonSettled([WS], START, END)).get(TAKER) ?? 0).toBeCloseTo(0, 6);
  });
});
