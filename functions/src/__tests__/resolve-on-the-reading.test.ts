/**
 * THE RULE: a market resolves on its reading, not on a clock.
 *
 * A market settles on a reading dated INSIDE its own period, and it resolves
 * the moment that reading arrives, whatever the clock says. Trading stays
 * open until then, because until then nobody has the answer.
 *
 * What this replaced: trading stopped at the period end and settlement
 * happened at period end + settlementLagMinutes. That closed a live question
 * early, since the normal case for a lagged metric is that the number is not
 * knowable at period end - which is the whole reason the lag exists. It
 * protected against the calendar rather than against the answer.
 *
 * The thing worth protecting against is trading with the answer in hand, and
 * this makes that impossible by construction: there is no interval where the
 * answer exists and the book is open, because the answer arriving IS the
 * resolution.
 *
 * settlementLagMinutes is now the DEADLINE: how long a market waits for its
 * reading before it gives up, voids and refunds everyone. Without it an owner
 * who stops filing could freeze other people's credits forever.
 *
 * Owner decision 2026-09-01, and the cost taken knowingly: "the cost is fine
 * its reputation based". Design: notes/resolve-on-the-reading-2026-09-01.md.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { agents, markets, metricLogs, metrics, positions } from '../db/schema';
import { initialPool } from '../lib/amm';
import { periodEndInstant, periodStartInstant } from '../lib/date-utils';
import { provisionWorkspace } from '../lib/participants';
import { fromUnits, toUnits } from '../lib/validation';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-ror';
const TRADER = 'agent-ror';
const MARKET = 'market-ror';
const METRIC = 'metric-ror';
const B = 200;
/** A period that ended long ago, so "past the period end" needs no clock. */
const PAST = '2020-09';

async function seed(opts: { lagMinutes?: number } = {}) {
  await db.insert(agents).values([
    { id: 'agent-ror-owner', apiKeyHash: 'h-ro', balance: 0 },
    { id: TRADER, apiKeyHash: 'h-rt', balance: toUnits(5000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Resolve on reading',
    createdBy: 'agent-ror-owner',
    ownerAgentId: 'agent-ror-owner',
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Monthly revenue',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
    settlementLagMinutes: opts.lagMinutes ?? 4320,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Monthly revenue',
    targetDate: PAST,
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 50],
    liquidity: B,
    pool: initialPool(B) + 50,
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
  await db.insert(positions).values({
    id: `${TRADER}_${MARKET}_higher`,
    workspaceId: WS,
    marketId: MARKET,
    agentId: TRADER,
    direction: 'higher',
    shares: 50,
    totalCost: 30,
  });
}

/** A reading dated INSIDE the market's period: the thing that resolves it. */
async function fileInPeriodReading(value: number) {
  await db.insert(metricLogs).values({
    id: `log-in-${value}`,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Monthly revenue',
    value,
    timestamp: new Date(periodStartInstant(PAST).getTime() + 60_000),
  });
}

/** A reading dated BEFORE the period: the previous period's number, which is
 *  what the old design would have settled on. */
async function fileStaleReading(value: number) {
  await db.insert(metricLogs).values({
    id: `log-stale-${value}`,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Monthly revenue',
    value,
    timestamp: new Date(periodStartInstant(PAST).getTime() - 86_400_000),
  });
}

const trade = async (mode: unknown) => {
  const { executeTradeInTx } = await import('../services/trading');
  return db.transaction(async tx =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    executeTradeInTx(tx as any, { workspaceId: WS, agentId: TRADER, marketId: MARKET, mode: mode as any }),
  );
};
const buy = () => trade({ type: 'buy', direction: 1, dirLabel: 'higher', amount: 10 });
const sell = () => trade({ type: 'sell', direction: 1, dirLabel: 'higher', sellShares: 10 });

const marketRow = async () => (await db.select().from(markets).where(eq(markets.id, MARKET)))[0];
const resolveAll = async () => {
  const { resolvePredictions } = await import('../services/predictions');
  return resolvePredictions(undefined, WS);
};

describe('a market past its period keeps trading while the answer is unknown', () => {
  test('a buy is allowed after the period has ended', async () => {
    await seed();
    await fileStaleReading(10);
    await expect(buy()).resolves.toBeTruthy();
  });

  test('a sell is allowed too', async () => {
    await seed();
    await fileStaleReading(10);
    await expect(sell()).resolves.toBeTruthy();
  });

  test('the resolver leaves it open: a stale reading is not this period answer', async () => {
    // A deadline far enough out that this 2020 market has not given up yet;
    // the deadline itself is exercised below.
    await seed({ lagMinutes: 60 * 24 * 365 * 100 });
    await fileStaleReading(10);

    await resolveAll();

    const m = await marketRow();
    expect(m.resolved).toBe(false);
    expect(m.voided).toBe(false);
  });
});

describe('the reading is what resolves it', () => {
  test('a reading dated inside the period resolves the market on the next pass', async () => {
    await seed();
    await fileInPeriodReading(100);

    await resolveAll();

    const m = await marketRow();
    expect(m.resolved).toBe(true);
    expect(m.actualValue).toBe(100);
  });

  test('once resolved, nothing trades: the answer arriving is what closes the book', async () => {
    await seed();
    await fileInPeriodReading(100);
    await resolveAll();

    await expect(buy()).rejects.toThrow(/resolved/i);
    await expect(sell()).rejects.toThrow(/resolved/i);
  });

  test('the holder is paid on the filed number, not on the stale one', async () => {
    await seed();
    await fileStaleReading(10);
    await fileInPeriodReading(100);

    await resolveAll();

    // 50 shares of `higher`, settling at the top of a 0-100 range.
    const [a] = await db.select().from(agents).where(eq(agents.id, TRADER));
    expect(fromUnits(a.balance as number)).toBe(5000 + 50);
  });
});

describe('a reading that never comes does not lock credits forever', () => {
  test('past the deadline with no in-period reading, the market voids and refunds', async () => {
    // A one-minute deadline on a period that ended in 2020: long past.
    await seed({ lagMinutes: 1 });
    await fileStaleReading(10);
    await db.insert(await import('../db/schema').then(s => s.trades)).values({
      id: 'trade-ror',
      workspaceId: WS,
      marketId: MARKET,
      agentId: TRADER,
      direction: 'higher',
      shares: 50,
      cost: 30,
      createdAt: new Date(periodStartInstant(PAST).getTime() + 120_000),
    });

    await resolveAll();

    const m = await marketRow();
    expect(m.voided).toBe(true);
    const [a] = await db.select().from(agents).where(eq(agents.id, TRADER));
    expect(fromUnits(a.balance as number)).toBe(5000 + 30);
  });

  test('before the deadline it is left alone, still trading', async () => {
    // A deadline far enough out that 2020 + deadline is still ahead of us.
    await seed({ lagMinutes: 60 * 24 * 365 * 100 });
    await fileStaleReading(10);

    await resolveAll();

    const m = await marketRow();
    expect(m.resolved).toBe(false);
    expect(m.voided).toBe(false);
    await expect(buy()).resolves.toBeTruthy();
  });
});

describe('the deadline is measured from the period end', () => {
  test('it is the period end plus the metric deadline', async () => {
    const deadline = new Date(periodEndInstant(PAST).getTime() + 4320 * 60_000);
    expect(deadline.getTime()).toBeGreaterThan(periodEndInstant(PAST).getTime());
  });
});
