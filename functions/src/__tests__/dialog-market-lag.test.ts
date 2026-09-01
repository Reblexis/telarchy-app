/**
 * THE RULE: every path that opens a market stamps the metric's reporting lag
 * onto it, so `settlesAt` is period end PLUS the lag.
 *
 * `ensureMarketsForTimePreference` is what the Dates dialog calls, and it
 * built its PendingMarket without `settlementLagMinutes`, so `settlesAt` was
 * the bare period end. A metric with a 3-day lag given a date through the
 * dialog settled at midnight on the last day of the period, on the newest
 * reading BEFORE that period closed - which is the exact failure the lag
 * shipped on 2026-08-31 to prevent. The refresh cron's path
 * (refreshRelativeDateMarkets) passed the lag all along, so two markets on
 * one metric could settle by different rules depending on which door opened
 * them (bug hunt 2026-08-31).
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { and, eq } from 'drizzle-orm';
import { agents, markets, metrics } from '../db/schema';
import { periodEndInstant, settlementInstantFor } from '../lib/date-utils';
import { provisionWorkspace } from '../lib/participants';
import { ensureMarketsForTimePreference } from '../services/metrics';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-lag';
const OWNER = 'agent-lag-owner';
const METRIC = 'metric-lag';
const LAG_MINUTES = 4320; // three days, the documented monthly-revenue case
const TARGET = '2099-09';

async function seed(lag: number) {
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-lag', balance: 0 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Lag',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Monthly revenue',
    value: 0,
    formula: '0',
    marketRangeMax: 1000,
    settlementLagMinutes: lag,
  });
}

const openedMarket = async () => {
  const [m] = await db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.targetDate, TARGET)));
  return m;
};

describe('a market opened from the dates dialog settles on the metric rules', () => {
  test('settlesAt is the period end plus the reporting lag', async () => {
    await seed(LAG_MINUTES);

    await ensureMarketsForTimePreference(
      METRIC,
      { enabled: false, halfLife: 1, customHorizons: [TARGET] } as never,
      WS,
    );

    const m = await openedMarket();
    expect(m).toBeTruthy();
    expect(m.settlesAt).toEqual(settlementInstantFor(TARGET, LAG_MINUTES));
    // And is genuinely later than the bare period end, so the assertion above
    // cannot pass by both sides being the same thing.
    expect(m.settlesAt!.getTime()).toBeGreaterThan(periodEndInstant(TARGET).getTime());
  });

  test('a metric with no lag still settles at the period end', async () => {
    await seed(0);

    await ensureMarketsForTimePreference(
      METRIC,
      { enabled: false, halfLife: 1, customHorizons: [TARGET] } as never,
      WS,
    );

    const m = await openedMarket();
    expect(m.settlesAt).toEqual(periodEndInstant(TARGET));
  });
});
