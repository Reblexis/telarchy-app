/**
 * Settlement is bounded per run (docs/infra/deploy.md, "Reads are bounded in
 * the size of a workspace"): a fixing is looked up once per (metric, target
 * date) with at most two lookups in flight, and one run settles at most
 * RESOLVE_BATCH_MAX books, reporting what it left for the next tick.
 *
 * Before this, resolvePredictions fired one metric_logs query per open
 * market in a single Promise.all: at midnight on a floor with 1,440 books due
 * that is 1,440 concurrent acquires against a pool of four with a 5 s
 * connection timeout, i.e. the "pool timeout looks like a DB failure" outage
 * (notes/snake-load-audit-2026-09-10.md, item 6).
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { agents, markets, metricLogs, metrics, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { mapWithConcurrency } from '../lib/concurrency';
import { periodStartInstant } from '../lib/date-utils';
import { captureQueries, db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-rb';
const METRIC = 'metric-rb';
/** A period that ended long ago, so every book on it is past its period end. */
const PAST = '2020-09';

async function seed(dueBooks: number) {
  await db.insert(agents).values({ id: 'agent-rb-owner', apiKeyHash: 'h-rb', balance: 0 });
  await db.insert(workspaces).values({
    id: WS,
    name: 'Resolve bounded',
    slug: 'resolve-bounded',
    createdBy: 'agent-rb-owner',
    visibility: 'public',
    // The per-book "market resolved" mail is not what this file measures.
    notificationsMuted: true,
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Monthly revenue',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  // The fixing: one reading inside the period, shared by every book on it.
  await db.insert(metricLogs).values({
    id: 'log-rb',
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Monthly revenue',
    value: 42,
    timestamp: new Date(periodStartInstant(PAST).getTime() + 60_000),
  });
  const rows = Array.from({ length: dueBooks }, (_, i) => ({
    id: `mkt-rb-${i}`,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Monthly revenue',
    targetDate: PAST,
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0] as [number, number],
    liquidity: 10,
    pool: initialPool(10),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  }));
  for (let i = 0; i < rows.length; i += 500) await db.insert(markets).values(rows.slice(i, i + 500));
}

const resolveOnce = async () => {
  const { resolvePredictions } = await import('../services/predictions');
  return resolvePredictions(undefined, WS);
};
const openCount = async () =>
  (await db.select({ id: markets.id }).from(markets).where(eq(markets.resolved, false))).length;

describe('mapWithConcurrency', () => {
  test('never has more than the limit in flight, and keeps the order', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 2, async n => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 5 + (n % 3) * 3));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(peak).toBe(2);
  });

  test('an empty list resolves to an empty list', async () => {
    expect(await mapWithConcurrency([], 2, async () => 1)).toEqual([]);
  });

  test('a rejection propagates', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async n => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});

describe('THE RULE: a fixing is looked up once per (metric, date), not once per book', () => {
  test('300 due books on one period cost a constant number of metric_logs reads', async () => {
    await seed(300);
    const cap = captureQueries();
    let result: Awaited<ReturnType<typeof resolveOnce>>;
    try {
      result = await resolveOnce();
    } finally {
      cap.stop();
    }
    expect(result.resolved).toBe(300);
    // The dueness lookup, one per group. Settlement itself reads the fixing
    // again per book (metricReadingInPeriod), which is sequential and inside
    // each book's own transaction; the fan-out is what this pins.
    const duenessReads = cap.queries.filter(
      q => q.includes('from "metric_logs"') && /limit/i.test(q) && !/order by/i.test(q),
    );
    expect(duenessReads.length).toBeLessThanOrEqual(2);
  }, 120_000);
});

describe('THE RULE: one run settles at most RESOLVE_BATCH_MAX books', () => {
  test('1,500 due books settle across runs, none of them in an unbounded Promise.all', async () => {
    const { RESOLVE_BATCH_MAX } = await import('../services/predictions');
    expect(RESOLVE_BATCH_MAX).toBe(500);
    await seed(1500);

    const first = await resolveOnce();
    expect(first.resolved).toBe(500);
    expect(first.remaining).toBe(1000);
    expect(await openCount()).toBe(1000);

    const second = await resolveOnce();
    expect(second.resolved).toBe(500);
    expect(second.remaining).toBe(500);

    const third = await resolveOnce();
    expect(third.resolved).toBe(500);
    expect(third.remaining).toBe(0);
    expect(await openCount()).toBe(0);

    const fourth = await resolveOnce();
    expect(fourth).toMatchObject({ resolved: 0, remaining: 0 });
  }, 600_000);
});
