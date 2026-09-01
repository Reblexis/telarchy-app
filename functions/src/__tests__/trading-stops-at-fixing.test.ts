/**
 * THE RULE: a market stops trading at its resolution instant, in both
 * directions, and settles when the reading arrives within the lag.
 *
 * A market settles on the last reading at or before its PERIOD END, but it
 * only becomes due at period end plus settlementLagMinutes, which can be 90
 * days. Nothing stood between the two: executeTradeInTx gated on
 * `market.active` and no clock, and refreshRelativeDateMarkets declares a
 * `toDeactivate` list it never pushes to, so the only writers of
 * active = false were resolve and void themselves.
 *
 * With a three-day lag, September's settling reading is readable through
 * /api/metrics on 1 October and the market kept filling until the 4th. A
 * trader read the answer and bought the winning side at a price that did not
 * know it yet (bug hunt 2026-08-31, P0-5).
 *
 * SELLING IS CLOSED TOO. The existing `closed` state means sell-only, and
 * after the fixing a holder of a losing position who sells at the last
 * printed price takes out what settlement would not have paid. Same leak,
 * facing the other way. Owner decision 2026-09-01: "the market should be
 * closed after its resolution date is passed and then settled once the
 * information is provided within the lag."
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { agents, markets, metrics, positions } from '../db/schema';
import { initialPool } from '../lib/amm';
import { periodEndInstant, settlementInstantFor } from '../lib/date-utils';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-fixing';
const TRADER = 'agent-fixing-trader';
const B = 200;
const LAG = 4320; // three days

/** A market on `targetDate` carrying `lag`, with the trader already holding
 *  shares so the sell path can be exercised too. */
async function seedMarket(targetDate: string, lag: number) {
  await db.insert(agents).values([
    { id: 'agent-fixing-owner', apiKeyHash: 'h-fo', balance: 0 },
    { id: TRADER, apiKeyHash: 'h-ft', balance: toUnits(5000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Fixing',
    createdBy: 'agent-fixing-owner',
    ownerAgentId: 'agent-fixing-owner',
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'metric-fixing',
    workspaceId: WS,
    name: 'Monthly revenue',
    value: 0,
    formula: '0',
    marketRangeMax: 1000,
    settlementLagMinutes: lag,
  });
  await db.insert(markets).values({
    id: 'market-fixing',
    workspaceId: WS,
    metricId: 'metric-fixing',
    metricName: 'Monthly revenue',
    targetDate,
    rangeMin: 0,
    rangeMax: 1000,
    shares: [0, 50],
    liquidity: B,
    pool: initialPool(B),
    active: true,
    resolved: false,
    voided: false,
    settlesAt: settlementInstantFor(targetDate, lag),
    proposalId: null,
  });
  await db.insert(positions).values({
    // The id the trade path derives and looks up by.
    id: `${TRADER}_market-fixing_higher`,
    workspaceId: WS,
    marketId: 'market-fixing',
    agentId: TRADER,
    direction: 'higher',
    shares: 50,
    totalCost: 30,
  });
}

const trade = async (mode: unknown) => {
  const { executeTradeInTx } = await import('../services/trading');
  return db.transaction(async tx =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    executeTradeInTx(tx as any, {
      workspaceId: WS,
      agentId: TRADER,
      marketId: 'market-fixing',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mode: mode as any,
    }),
  );
};

const buy = () => trade({ type: 'buy', direction: 1, dirLabel: 'higher', amount: 10 });
const sell = () => trade({ type: 'sell', direction: 1, dirLabel: 'higher', sellShares: 10 });

/** A period that ended long ago, so "past the fixing" needs no clock control. */
const PAST = '2020-09';
/** A period far enough out that it is trading normally. */
const FUTURE = '2099-09';

describe('trading stops at the resolution instant', () => {
  test('the window is real: the fixing is days before the market is due', async () => {
    expect(settlementInstantFor(PAST, LAG).getTime()).toBeGreaterThan(periodEndInstant(PAST).getTime());
  });

  test('a buy after the resolution instant is refused, even inside the lag', async () => {
    await seedMarket(PAST, LAG);
    await expect(buy()).rejects.toThrow(/settl/i);
  });

  test('a sell after the resolution instant is refused too', async () => {
    await seedMarket(PAST, LAG);
    await expect(sell()).rejects.toThrow(/settl/i);
  });

  test('the market is untouched by the refusal', async () => {
    await seedMarket(PAST, LAG);
    await buy().catch(() => {});
    const [m] = await db.select().from(markets).where(eq(markets.id, 'market-fixing'));
    expect(m.shares).toEqual([0, 50]);
    const [a] = await db.select().from(agents).where(eq(agents.id, TRADER));
    expect(a.balance).toBe(toUnits(5000));
  });
});

describe('a market before its resolution instant still trades', () => {
  test('a buy is allowed', async () => {
    await seedMarket(FUTURE, LAG);
    await expect(buy()).resolves.toBeTruthy();
  });

  test('a sell is allowed', async () => {
    await seedMarket(FUTURE, LAG);
    await expect(sell()).resolves.toBeTruthy();
  });

  test('a market with no lag trades right up to its period end', async () => {
    await seedMarket(FUTURE, 0);
    await expect(buy()).resolves.toBeTruthy();
  });
});
