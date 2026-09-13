/**
 * "Skill vs reference" (docs/metrics.md): over the markets scored in the
 * trailing 30 days, the share where the market's call at the close landed
 * closer to the actual than the reference forecaster's mature estimate, a tie
 * counting as half.
 *
 * What is pinned here is each rule the definition exists to enforce: the
 * benchmark is the reference's latest mature estimate filed before the
 * resolution and nobody else's; the market's call is its closing book; only
 * resolved, numbered, 1,000-credit markets inside the window are scored; the
 * metric never scores itself.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, marketForecasts, markets, metrics, workspaces } from '../db/schema';
import {
  REFERENCE_PARTICIPANT,
  SKILL_METRIC_NAME,
  SKILL_MIN_LIQUIDITY,
  skillVsReference30d,
} from '../services/platform-stats';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const NOW = new Date('2026-09-13T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const days = (n: number) => n * 24 * HOUR;

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);

beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: 'ref', apiKeyHash: 'h1', balance: 0, nickname: REFERENCE_PARTICIPANT, platformOperated: true },
    { id: 'other', apiKeyHash: 'h2', balance: 0, nickname: 'other-bot' },
  ]);
  await db.insert(workspaces).values([
    { id: 'ws', name: 'W', slug: 'w', createdBy: 'ref', visibility: 'public' },
    { id: 'ws2', name: 'W2', slug: 'w2', createdBy: 'ref', visibility: 'public' },
  ]);
  await db.insert(metrics).values([
    { id: 'metric', workspaceId: 'ws', name: 'Revenue', value: 0, formula: '0', marketRangeMax: 100 },
    { id: 'metric2', workspaceId: 'ws2', name: 'Other', value: 0, formula: '0', marketRangeMax: 100 },
    { id: 'skill', workspaceId: 'ws', name: SKILL_METRIC_NAME, value: 0, formula: '0', marketRangeMax: 1 },
  ]);
});

let seq = 0;
const resolvedAtOf = new Map<string, Date>();

/**
 * One market whose closing book calls `call`. The shares are the LMSR position
 * that implies exactly that consensus, so the test states the call rather than
 * the book; `shares` overrides it.
 */
async function market(opts: {
  call?: number;
  shares?: [number, number];
  actual?: number | null;
  resolvedAgo?: number;
  liquidity?: number;
  rangeMax?: number;
  resolved?: boolean;
  voided?: boolean;
  workspaceId?: string;
  metricId?: string;
  metricName?: string;
}) {
  const id = `m-${++seq}`;
  const rangeMax = opts.rangeMax ?? 100;
  const liquidity = opts.liquidity ?? 1500;
  let shares = opts.shares;
  if (!shares) {
    const p = (opts.call ?? rangeMax / 2) / rangeMax;
    const diff = liquidity * Math.log(p / (1 - p));
    shares = diff >= 0 ? [0, diff] : [-diff, 0];
  }
  const resolved = opts.resolved ?? true;
  const resolvedAt = resolved ? new Date(NOW.getTime() - days(opts.resolvedAgo ?? 1)) : null;
  if (resolvedAt) resolvedAtOf.set(id, resolvedAt);
  await db.insert(markets).values({
    id,
    workspaceId: opts.workspaceId ?? 'ws',
    metricId: opts.metricId ?? 'metric',
    metricName: opts.metricName ?? 'Revenue',
    targetDate: '2026-09-10',
    rangeMin: 0,
    rangeMax,
    shares,
    liquidity,
    pool: 0,
    active: !resolved,
    resolved,
    voided: opts.voided ?? false,
    actualValue: opts.actual === undefined ? 50 : opts.actual,
    resolvedAt,
  });
  return id;
}

/** A forecast on a market, by default the reference's mature one an hour before it resolved. */
async function forecast(
  marketId: string,
  value: number,
  opts: { stage?: string; agentId?: string; at?: Date; workspaceId?: string } = {},
) {
  const resolvedAt = resolvedAtOf.get(marketId) ?? NOW;
  await db.insert(marketForecasts).values({
    id: `f-${++seq}`,
    workspaceId: opts.workspaceId ?? 'ws',
    marketId,
    agentId: opts.agentId ?? 'ref',
    value,
    stage: opts.stage ?? 'mature',
    model: 'test',
    createdAt: opts.at ?? new Date(resolvedAt.getTime() - HOUR),
  });
}

describe('THE RULE: the market wins a market only when its closing call is closer to the actual than the reference', () => {
  test('the market closer than the reference is a win', async () => {
    await forecast(await market({ call: 52, actual: 50 }), 60);
    expect(await skillVsReference30d(NOW)).toMatchObject({ winRate: 1, markets: 1 });
  });

  test('the reference closer than the market is a loss', async () => {
    await forecast(await market({ call: 60, actual: 50 }), 51);
    expect(await skillVsReference30d(NOW)).toMatchObject({ winRate: 0, markets: 1 });
  });

  test('a tie counts as half a win', async () => {
    await forecast(await market({ call: 55, actual: 50 }), 45);
    expect(await skillVsReference30d(NOW)).toMatchObject({ winRate: 0.5, markets: 1 });
  });

  test('the win rate is the share of scored markets: two wins and a loss is two thirds', async () => {
    await forecast(await market({ call: 52, actual: 50 }), 60);
    await forecast(await market({ call: 70, actual: 50 }), 49);
    await forecast(await market({ call: 40, actual: 41 }), 20);
    const r = await skillVsReference30d(NOW);
    expect(r.markets).toBe(3);
    expect(r.winRate).toBeCloseTo(2 / 3, 10);
  });

  test("the market's call is its closing book: an untraded book calls the midpoint", async () => {
    await forecast(await market({ shares: [0, 0], actual: 52 }), 60);
    expect(await skillVsReference30d(NOW)).toMatchObject({ winRate: 1, markets: 1, marketError: 0.02 });
  });
});

describe("THE RULE: the benchmark is the reference's latest mature estimate filed before the resolution", () => {
  test('a market with only a spawn forecast is not scored', async () => {
    await forecast(await market({ call: 52 }), 60, { stage: 'spawn' });
    expect(await skillVsReference30d(NOW)).toEqual({
      winRate: null,
      markets: 0,
      marketError: null,
      referenceError: null,
    });
  });

  test("another participant's mature forecast is not the reference's", async () => {
    await forecast(await market({ call: 52 }), 60, { agentId: 'other' });
    expect((await skillVsReference30d(NOW)).markets).toBe(0);
  });

  test('of two mature forecasts the later one is the estimate', async () => {
    const id = await market({ call: 52, actual: 50 });
    const resolvedAt = resolvedAtOf.get(id)!;
    await forecast(id, 90, { at: new Date(resolvedAt.getTime() - 5 * HOUR) });
    await forecast(id, 51, { at: new Date(resolvedAt.getTime() - 2 * HOUR) });
    expect(await skillVsReference30d(NOW)).toMatchObject({ winRate: 0, markets: 1 });
  });

  test('a mature forecast filed after the market resolved does not count', async () => {
    const id = await market({ call: 52, actual: 50 });
    await forecast(id, 50, { at: new Date(resolvedAtOf.get(id)!.getTime() + HOUR) });
    expect((await skillVsReference30d(NOW)).markets).toBe(0);
  });

  test('a later forecast filed after the resolution does not replace the one filed before it', async () => {
    const id = await market({ call: 52, actual: 50 });
    const resolvedAt = resolvedAtOf.get(id)!;
    await forecast(id, 60, { at: new Date(resolvedAt.getTime() - HOUR) });
    await forecast(id, 50, { at: new Date(resolvedAt.getTime() + HOUR) });
    expect(await skillVsReference30d(NOW)).toMatchObject({ winRate: 1, markets: 1 });
  });
});

describe('which markets are scored', () => {
  test(`the liquidity line is ${SKILL_MIN_LIQUIDITY} credits: exactly it is scored, a hair under is not`, async () => {
    expect(SKILL_MIN_LIQUIDITY).toBe(1000);
    await forecast(await market({ call: 52, liquidity: 1000 }), 60);
    await forecast(await market({ call: 52, liquidity: 999.99 }), 60);
    expect((await skillVsReference30d(NOW)).markets).toBe(1);
  });

  test('a voided market is not scored', async () => {
    await forecast(await market({ call: 52, voided: true, actual: null }), 60);
    expect((await skillVsReference30d(NOW)).markets).toBe(0);
  });

  test('a market that settled N/A (no actual) is not scored', async () => {
    await forecast(await market({ call: 52, actual: null }), 60);
    expect((await skillVsReference30d(NOW)).markets).toBe(0);
  });

  test('an open market is not scored', async () => {
    const id = await market({ call: 52, resolved: false });
    await forecast(id, 60, { at: new Date(NOW.getTime() - HOUR) });
    expect((await skillVsReference30d(NOW)).markets).toBe(0);
  });

  test('the window is the trailing 30 days: resolved 29 days ago counts, 31 days ago does not', async () => {
    await forecast(await market({ call: 52, resolvedAgo: 29 }), 60);
    await forecast(await market({ call: 52, resolvedAgo: 31 }), 60);
    expect((await skillVsReference30d(NOW)).markets).toBe(1);
  });

  test('THE RULE: the metric never scores itself', async () => {
    await forecast(
      await market({ call: 0.6, rangeMax: 1, actual: 0.5, metricId: 'skill', metricName: SKILL_METRIC_NAME }),
      0.9,
    );
    expect((await skillVsReference30d(NOW)).markets).toBe(0);
  });

  test("every workspace's markets are scored", async () => {
    const id = await market({ call: 52, workspaceId: 'ws2', metricId: 'metric2', metricName: 'Other' });
    await forecast(id, 60, { workspaceId: 'ws2' });
    expect((await skillVsReference30d(NOW)).markets).toBe(1);
  });
});

describe('published beside the win rate', () => {
  test('each side’s mean absolute error is a fraction of its market’s range', async () => {
    await forecast(await market({ call: 60, actual: 50 }), 45);
    await forecast(await market({ call: 500, actual: 600, rangeMax: 1000 }), 700);
    const r = await skillVsReference30d(NOW);
    expect(r.markets).toBe(2);
    expect(r.marketError).toBeCloseTo(0.1, 6);
    expect(r.referenceError).toBeCloseTo(0.075, 6);
  });

  test('nothing scored reads null, not zero: a zero would say the floor lost every market', async () => {
    expect(await skillVsReference30d(NOW)).toEqual({
      winRate: null,
      markets: 0,
      marketError: null,
      referenceError: null,
    });
  });
});
