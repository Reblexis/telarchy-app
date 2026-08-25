/**
 * Settlement fixing: a market's actualValue is the metric value AS OF
 * resolvesOn (the last metric_logs row at-or-before the period-end boundary),
 * not the live value at whatever moment the resolve cron happens to run.
 *
 * Regression: the resolve cron drifts (observed +12s to +80min past the
 * hour). Value-at-cron-time made hour markets resolve against the previous
 * or the next hour's reading depending on the race: 6 of the first 15 hour
 * markets on prod settled on the wrong hour's value. The fixing makes the
 * settled value deterministic; cron timing only affects payout latency.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { and, eq } from 'drizzle-orm';
import { agents, markets, metricLogs, metrics, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { periodEndInstant } from '../lib/date-utils';
import { toUnits } from '../lib/validation';
import { metricValueAsOf } from '../services/metrics';
import { resolvePredictions } from '../services/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-fixing';
const OWNER = 'owner-fixing';
const METRIC = 'metric-fixing';
const MARKET = 'market-fixing';

/** Hour-granularity targetDate (YYYY-MM-DDTHH, UTC) for `hoursAgo` hours ago. */
function hourTargetDate(hoursAgo: number): string {
  const d = new Date(Date.now() - hoursAgo * 3600_000);
  return d.toISOString().slice(0, 13);
}

// A due hour market: period ended >= 1h ago, so resolvePredictions picks it up
// no matter when the test runs.
const TARGET = hourTargetDate(2);
const BOUNDARY = periodEndInstant(TARGET);

const LIVE_VALUE = 9; // metric's current value at "cron time" (now)

async function seedWorld(opts: { logs?: Array<{ offsetMs: number; value: number; outlook?: number | null }> } = {}) {
  await db.insert(workspaces).values({
    id: WS,
    name: 'Fixing Test',
    createdBy: OWNER,
    visibility: 'private',
  });
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-fixing', balance: toUnits(0) });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Trailing counter',
    value: LIVE_VALUE,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Trailing counter',
    targetDate: TARGET,
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 10,
    pool: initialPool(10),
    active: true,
    resolved: false,
    voided: false,
  });
  for (const log of opts.logs ?? []) {
    await db.insert(metricLogs).values({
      id: `log-${log.offsetMs}`,
      workspaceId: WS,
      metricId: METRIC,
      metricName: 'Trailing counter',
      value: log.value,
      outlook: log.outlook === undefined ? log.value : log.outlook,
      timestamp: new Date(BOUNDARY.getTime() + log.offsetMs),
    });
  }
}

async function resolvedMarket() {
  const [m] = await db
    .select()
    .from(markets)
    .where(and(eq(markets.id, MARKET), eq(markets.workspaceId, WS)));
  return m;
}

describe('settlement fixing at resolvesOn', () => {
  test('post-boundary update is ignored; the last pre-boundary value settles', async () => {
    await seedWorld({
      logs: [
        { offsetMs: -3598_000, value: 5 }, // pushed just after the period opened
        { offsetMs: +2_000, value: LIVE_VALUE }, // the next hour's push, 2s after the boundary
      ],
    });

    const result = await resolvePredictions(undefined, WS);
    expect(result.resolved).toBe(1);

    const m = await resolvedMarket();
    expect(m.resolved).toBe(true);
    expect(m.actualValue).toBe(5); // NOT the live value 9
  });

  test('multiple pre-boundary updates: the latest one wins', async () => {
    await seedWorld({
      logs: [
        { offsetMs: -3598_000, value: 3 },
        { offsetMs: -1800_000, value: 4 },
        { offsetMs: -2_000, value: 7 }, // last before the boundary
        { offsetMs: +5_000, value: LIVE_VALUE },
      ],
    });

    await resolvePredictions(undefined, WS);
    expect((await resolvedMarket()).actualValue).toBe(7);
  });

  test('outlook is preferred over raw value (historical m.total parity)', async () => {
    await seedWorld({
      logs: [{ offsetMs: -2_000, value: 7, outlook: 7.5 }],
    });

    await resolvePredictions(undefined, WS);
    expect((await resolvedMarket()).actualValue).toBe(7.5);
  });

  test('no logs at-or-before the boundary: falls back to the live value, loudly', async () => {
    await seedWorld({ logs: [{ offsetMs: +2_000, value: 42 }] });

    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await resolvePredictions(undefined, WS);
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('no metric log at-or-before'));
    } finally {
      consoleError.mockRestore();
    }

    expect((await resolvedMarket()).actualValue).toBe(LIVE_VALUE);
  });

  test('metricValueAsOf treats a log exactly at the boundary as pre-boundary', async () => {
    await seedWorld({
      logs: [
        { offsetMs: -10_000, value: 1 },
        { offsetMs: 0, value: 2 }, // exactly at resolvesOn -> counts for this fixing
        { offsetMs: +10_000, value: 3 },
      ],
    });

    expect(await metricValueAsOf(METRIC, BOUNDARY, WS)).toBe(2);
  });
});
