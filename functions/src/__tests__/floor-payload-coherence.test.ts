/**
 * The public floor payload has to agree with itself.
 *
 * Every visible bug on the floor in the week of 2026-08-11 was one field
 * contradicting another inside a single response, and each was caught by a
 * person looking at the page rather than by a test:
 *
 *   - a price series shipped without saying which market it replayed, so the
 *     page drew the year's $77k line under the week's $213 call;
 *   - a weekly market targeted a week that had not started, so its chart drew
 *     this week's accumulation against next week's forecast;
 *   - a contract's conditional pair sat on a horizon the floor no longer had,
 *     so its "impact" was priced on a week nobody could trade;
 *   - an approved branch priced at 1.0 on a 0..50 range, from a dollar ask
 *     subtracted off a headcount.
 *
 * So this file is not about one endpoint's happy path. It builds a floor that
 * looks like production - several open markets, contracts, decided contracts, trades,
 * readings - and then asserts the CROSS-FIELD invariants a reader depends on.
 * A change that breaks any of them changes what the floor means, and should
 * fail here before anyone sees it.
 *
 * Adding a field to this payload? Add its invariant here.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, announcements, markets, metricLogs, metrics, permissionGroups, proposals, trades } from '../db/schema';
import { initialPool } from '../lib/amm';
import { periodEndInstant, periodStartInstant, resolutionInstant } from '../lib/date-utils';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { marketplaceRouter } from '../routes/marketplace';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-coherence';
const OWNER = 'agent-coh-owner';
const TRADER = 'agent-coh-trader';
const YEAR_METRIC = 'metric-coh-year';
const WEEK_METRIC = 'metric-coh-week';
const YEAR_MARKET = 'mkt-coh-year';
const WEEK_MARKET = 'mkt-coh-week';

type Market = {
  marketId: string;
  metricId: string;
  metricName: string;
  targetDate: string;
  resolvesOn: string;
  consensus: number | null;
  probability: number;
  liquidity: number;
  rangeMin: number;
  rangeMax: number;
};
type Horizon = {
  marketId: string;
  metricName: string;
  targetDate: string;
  periodStart: string;
  resetsEvery: string | null;
  description: string | null;
  points: Array<{ at: string | null; value: number }>;
};
type Pair = {
  metricName: string;
  targetDate: string;
  resolvesOn: string;
  approvedConsensus: number | null;
  declinedConsensus: number | null;
  delta: number | null;
  approvedMarketId: string | null;
  declinedMarketId: string | null;
  rangeMin: number;
  rangeMax: number;
};
type Proposal = { id: string; status: string; askUsd: number; markets: Pair[] };
type Floor = {
  markets: Market[];
  horizonHistories: Horizon[];
  marketHistory: Array<{ at: string; consensus: number | null }>;
  marketHistoryMarketId: string;
  proposals: Proposal[];
  heroHistory: Array<{ at: string; value: number }>;
  latestAnnouncement: {
    id: string;
    body: string;
    publishedAt: string;
    editedAt: string | null;
    originalBody: string | null;
  } | null;
  announcementCount: number;
};

/**
 * A floor with more markets than it shows: a dollar metric
 * and a countable one, contracts in every state, real trades, real readings.
 */
async function seedFloor() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-coh-o', balance: 1_000_000_000_000 },
    { id: TRADER, apiKeyHash: 'h-coh-t', balance: 1_000_000_000_000, nickname: 'coh-trader' },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Coherence Floor',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  const [publicGroup] = await db
    .select()
    .from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, WS), eq(permissionGroups.type, 'public')));
  await db
    .update(permissionGroups)
    .set({ capabilities: ['read', 'trade'] })
    .where(eq(permissionGroups.id, publicGroup.id));

  await db.insert(metrics).values([
    {
      id: YEAR_METRIC,
      workspaceId: WS,
      name: 'Net 2026 (USD)',
      value: 45_000,
      formula: '0',
      marketRangeMax: 150_000,
      description: 'Everything earned in 2026.',
    },
    {
      id: WEEK_METRIC,
      workspaceId: WS,
      name: 'Revenue this week (USD)',
      value: 1_179,
      formula: '0',
      marketRangeMax: 8_000,
      description: 'Resets every Monday.',
      resetsEvery: 'week',
    },
  ]);
  await db.insert(markets).values([
    {
      id: WEEK_MARKET,
      workspaceId: WS,
      metricId: WEEK_METRIC,
      metricName: 'Revenue this week (USD)',
      targetDate: '2026-W34',
      rangeMin: 0,
      rangeMax: 8_000,
      shares: [0, 0],
      liquidity: 200,
      pool: initialPool(200),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
      branch: null,
    },
    {
      id: YEAR_MARKET,
      workspaceId: WS,
      metricId: YEAR_METRIC,
      metricName: 'Net 2026 (USD)',
      targetDate: '2026-12',
      rangeMin: 0,
      rangeMax: 150_000,
      shares: [0, 12],
      liquidity: 5_000,
      pool: initialPool(5_000),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
      branch: null,
    },
  ]);
  await db.insert(metricLogs).values([
    {
      id: 'log-y1',
      workspaceId: WS,
      metricId: YEAR_METRIC,
      metricName: 'Net 2026 (USD)',
      value: 137,
      timestamp: new Date('2026-01-04T09:00:00Z'),
    },
    {
      id: 'log-y2',
      workspaceId: WS,
      metricId: YEAR_METRIC,
      metricName: 'Net 2026 (USD)',
      value: 45_000,
      timestamp: new Date('2026-08-16T09:00:00Z'),
    },
    // Last week's total, which is not this market's actual-so-far.
    {
      id: 'log-w0',
      workspaceId: WS,
      metricId: WEEK_METRIC,
      metricName: 'Revenue this week (USD)',
      value: 1_180,
      timestamp: new Date('2026-08-16T10:00:00Z'),
    },
    {
      id: 'log-w1',
      workspaceId: WS,
      metricId: WEEK_METRIC,
      metricName: 'Revenue this week (USD)',
      value: 887,
      timestamp: new Date('2026-08-18T09:00:00Z'),
    },
    {
      id: 'log-w2',
      workspaceId: WS,
      metricId: WEEK_METRIC,
      metricName: 'Revenue this week (USD)',
      value: 1_179,
      timestamp: new Date('2026-08-19T09:00:00Z'),
    },
  ]);
  await db.insert(trades).values([
    {
      id: 'trd-coh-1',
      workspaceId: WS,
      agentId: TRADER,
      marketId: YEAR_MARKET,
      direction: 'higher',
      shares: 12,
      cost: 40,
      createdAt: new Date('2026-08-16T10:00:00Z'),
    },
  ]);

  // One pending contract priced on BOTH clocks, one approved and one declined,
  // each with the branch pairs a decided contract keeps.
  await db.insert(proposals).values([
    {
      id: 'prop-pending',
      workspaceId: WS,
      proposedBy: TRADER,
      title: '$2000: new trailer',
      description: 'A better trailer.',
      askUsd: 2000,
      status: 'pending',
      conditionalMarketIds: ['cm-p-y-a', 'cm-p-y-d', 'cm-p-w-a', 'cm-p-w-d'],
    },
    {
      id: 'prop-approved',
      workspaceId: WS,
      proposedBy: TRADER,
      title: '$10: a post',
      description: 'A post.',
      askUsd: 10,
      status: 'approved',
      conditionalMarketIds: ['cm-a-y-a', 'cm-a-y-d'],
      resolvedAt: new Date('2026-08-18T10:00:00Z'),
    },
    {
      id: 'prop-declined',
      workspaceId: WS,
      proposedBy: TRADER,
      title: '$13: another post',
      description: 'Another post.',
      askUsd: 13,
      status: 'declined',
      conditionalMarketIds: ['cm-d-y-a', 'cm-d-y-d'],
      resolvedAt: new Date('2026-08-18T11:00:00Z'),
      declineReason: 'Not worth it.',
    },
  ]);
  const branch = (
    id: string,
    proposalId: string,
    br: 'approved' | 'declined',
    metricId: string,
    metricName: string,
    targetDate: string,
    rangeMax: number,
    // [lower, higher]: index 1 is a bet the number goes UP, which is the
    // convention the AMM and the trade replay both use.
    shares: [number, number],
    voided = false,
    resolved = false,
  ) => ({
    id,
    workspaceId: WS,
    metricId,
    metricName,
    targetDate,
    rangeMin: 0,
    rangeMax,
    shares,
    liquidity: 250,
    pool: voided ? 0 : initialPool(250),
    active: !voided && !resolved,
    resolved,
    voided,
    proposalId,
    branch: br,
  });
  await db.insert(markets).values([
    branch('cm-p-y-a', 'prop-pending', 'approved', YEAR_METRIC, 'Net 2026 (USD)', '2026-12', 150_000, [0, 30]),
    branch('cm-p-y-d', 'prop-pending', 'declined', YEAR_METRIC, 'Net 2026 (USD)', '2026-12', 150_000, [0, 0]),
    branch('cm-p-w-a', 'prop-pending', 'approved', WEEK_METRIC, 'Revenue this week (USD)', '2026-W34', 8_000, [0, 0]),
    branch('cm-p-w-d', 'prop-pending', 'declined', WEEK_METRIC, 'Revenue this week (USD)', '2026-W34', 8_000, [0, 0]),
    // An approved contract keeps the world that happened and voids the other.
    branch('cm-a-y-a', 'prop-approved', 'approved', YEAR_METRIC, 'Net 2026 (USD)', '2026-12', 150_000, [0, 5]),
    branch('cm-a-y-d', 'prop-approved', 'declined', YEAR_METRIC, 'Net 2026 (USD)', '2026-12', 150_000, [0, 3], true),
    branch('cm-d-y-a', 'prop-declined', 'approved', YEAR_METRIC, 'Net 2026 (USD)', '2026-12', 150_000, [0, 2], true),
    branch('cm-d-y-d', 'prop-declined', 'declined', YEAR_METRIC, 'Net 2026 (USD)', '2026-12', 150_000, [0, 0]),
  ]);
}

async function floor(): Promise<Floor> {
  const res = await request(app).get(`/api/marketplace/${WS}`);
  expect(res.status).toBe(200);
  return res.body as Floor;
}

beforeEach(async () => {
  await seedFloor();
});

describe('every market describes itself completely', () => {
  test('a price is inside the band it can settle in', async () => {
    const f = await floor();
    expect(f.markets.length).toBeGreaterThan(0);
    for (const m of f.markets) {
      expect(m.consensus).not.toBeNull();
      expect(m.consensus!).toBeGreaterThanOrEqual(m.rangeMin);
      expect(m.consensus!).toBeLessThanOrEqual(m.rangeMax);
      expect(m.rangeMax).toBeGreaterThan(m.rangeMin);
      expect(m.probability).toBeGreaterThan(0);
      expect(m.probability).toBeLessThan(1);
    }
  });

  test('resolvesOn is the settle instant of the target period, to the second', async () => {
    const f = await floor();
    for (const m of f.markets) {
      expect(m.resolvesOn).toBe(resolutionInstant(m.targetDate));
      expect(new Date(m.resolvesOn).getTime()).toBeGreaterThan(Date.parse('2026-01-01T00:00:00Z'));
    }
  });

  test('the list is soonest-first, which is the contract the floor reverses', async () => {
    // The page flips this to show the decision first. If the server ever
    // shipped another order, the floor would call the week its decision.
    const f = await floor();
    const ends = f.markets.map(m => periodEndInstant(m.targetDate).getTime());
    expect([...ends].sort((a, b) => a - b)).toEqual(ends);
    expect(f.markets.map(m => m.targetDate)).toEqual(['2026-W34', '2026-12']);
  });

  test('no market appears twice, and none is a branch', async () => {
    const f = await floor();
    const ids = f.markets.map(m => m.marketId);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = f.markets.map(m => `${m.metricId}:${m.targetDate}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(ids).not.toContain('cm-p-y-a');
  });
});

describe('the price replay names its market', () => {
  test('marketHistoryMarketId is a market on this floor', async () => {
    const f = await floor();
    expect(f.markets.map(m => m.marketId)).toContain(f.marketHistoryMarketId);
  });

  test('it is the primary horizon: the furthest-resolving one', async () => {
    // The floor leads with the decision, and the inline series exists so that
    // first paint needs no second request. Pointing it at another horizon
    // would make the opening chart a fetch behind.
    const f = await floor();
    const last = f.markets[f.markets.length - 1];
    expect(f.marketHistoryMarketId).toBe(last.marketId);
    expect(f.marketHistoryMarketId).toBe(YEAR_MARKET);
  });

  test("every replayed price is inside that market's band", async () => {
    const f = await floor();
    const market = f.markets.find(m => m.marketId === f.marketHistoryMarketId)!;
    expect(f.marketHistory.length).toBeGreaterThan(0);
    for (const pt of f.marketHistory) {
      if (pt.consensus === null) continue;
      expect(pt.consensus).toBeGreaterThanOrEqual(market.rangeMin);
      expect(pt.consensus).toBeLessThanOrEqual(market.rangeMax);
    }
    // And it ends where the market currently is.
    expect(f.marketHistory[f.marketHistory.length - 1].consensus).toBeCloseTo(market.consensus!, 6);
  });
});

describe('every horizon carries its own history', () => {
  test('one row per open market, keyed by market id', async () => {
    const f = await floor();
    expect(f.horizonHistories.map(h => h.marketId).sort()).toEqual(f.markets.map(m => m.marketId).sort());
  });

  test("a row's metric name and target date match its market", async () => {
    const f = await floor();
    for (const h of f.horizonHistories) {
      const m = f.markets.find(mm => mm.marketId === h.marketId)!;
      expect(h.metricName).toBe(m.metricName);
      expect(h.targetDate).toBe(m.targetDate);
    }
  });

  test('periodStart is the first moment of the period, and precedes settlement', async () => {
    const f = await floor();
    for (const h of f.horizonHistories) {
      expect(h.periodStart).toBe(periodStartInstant(h.targetDate).toISOString());
      const m = f.markets.find(mm => mm.marketId === h.marketId)!;
      expect(new Date(h.periodStart).getTime()).toBeLessThan(new Date(m.resolvesOn).getTime());
    }
  });

  test("a row's readings are the metric's own, oldest first, nothing borrowed", async () => {
    const f = await floor();
    const week = f.horizonHistories.find(h => h.targetDate === '2026-W34')!;
    const year = f.horizonHistories.find(h => h.targetDate === '2026-12')!;
    expect(week.points.map(p => p.value)).toEqual([887, 1179]);
    expect(year.points.map(p => p.value)).toEqual([137, 45_000]);
    for (const h of f.horizonHistories) {
      const ats = h.points.map(p => Date.parse(p.at!));
      expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    }
  });

  test("the primary horizon's row and heroHistory tell the same story", async () => {
    const f = await floor();
    const primary = f.horizonHistories.find(h => h.marketId === f.marketHistoryMarketId)!;
    expect(primary.points.map(p => p.value)).toEqual(f.heroHistory.map(p => p.value));
  });
});

describe('a contract is priced on horizons this floor actually has', () => {
  test('every pending pair sits on an open horizon', async () => {
    // The failure this pins: the weekly baseline rolled to a new week and the
    // contracts' weekly pairs stayed on the old one, so the ballot showed an
    // impact priced on a week that was no longer on the page.
    const f = await floor();
    const open = new Set(f.markets.map(m => `${m.metricName}:${m.targetDate}`));
    const pending = f.proposals.find(p => p.id === 'prop-pending')!;
    expect(pending.markets.length).toBeGreaterThan(0);
    for (const pair of pending.markets) {
      expect(open.has(`${pair.metricName}:${pair.targetDate}`)).toBe(true);
    }
  });

  test('a pending pair has both worlds, and both are priced', async () => {
    const f = await floor();
    const pending = f.proposals.find(p => p.id === 'prop-pending')!;
    for (const pair of pending.markets) {
      expect(pair.approvedMarketId).toBeTruthy();
      expect(pair.declinedMarketId).toBeTruthy();
      expect(pair.approvedConsensus).not.toBeNull();
      expect(pair.declinedConsensus).not.toBeNull();
      expect(pair.delta).toBeCloseTo(pair.approvedConsensus! - pair.declinedConsensus!, 6);
    }
  });

  test("a branch price stays inside the metric's band, and an untraded pair predicts nothing", async () => {
    // Both halves of the 2026-08-15 failure: an approved branch pinned at the
    // range floor by a dollar ask, and an identical fake impact on every
    // contract. An untraded pair must open at zero delta.
    const f = await floor();
    const pending = f.proposals.find(p => p.id === 'prop-pending')!;
    for (const pair of pending.markets) {
      for (const c of [pair.approvedConsensus!, pair.declinedConsensus!]) {
        expect(c).toBeGreaterThan(pair.rangeMin);
        expect(c).toBeLessThan(pair.rangeMax);
      }
    }
    const untraded = pending.markets.find(p => p.targetDate === '2026-W34')!;
    expect(untraded.delta).toBeCloseTo(0, 6);
    // The traded one moved, and in the direction of the trade.
    const traded = pending.markets.find(p => p.targetDate === '2026-12')!;
    expect(traded.delta!).toBeGreaterThan(0);
  });

  test('a decided contract keeps the record and never resurrects the dead world', async () => {
    const f = await floor();
    const approved = f.proposals.find(p => p.id === 'prop-approved')!;
    const declined = f.proposals.find(p => p.id === 'prop-declined')!;
    expect(approved.status).toBe('approved');
    expect(declined.status).toBe('declined');
    // A decided contract still shows the impact that was priced for it.
    for (const p of [approved, declined]) {
      expect(p.markets.length).toBeGreaterThan(0);
      expect(p.markets[0].delta).not.toBeNull();
    }
  });

  test('nothing on the ballot is priced on a metric this floor does not run', async () => {
    const f = await floor();
    const names = new Set(f.markets.map(m => m.metricName));
    for (const p of f.proposals) {
      for (const pair of p.markets) expect(names.has(pair.metricName)).toBe(true);
    }
  });
});

describe('a resetting metric only shows the period it is measuring', () => {
  test("readings from the previous period are not this market's actual-so-far", async () => {
    // The report: the "revenue this week" chart drew last week's $1,180 as
    // this week's actual, on a market about a week that had barely started.
    const f = await floor();
    const week = f.horizonHistories.find(h => h.targetDate === '2026-W34')!;
    expect(week.resetsEvery).toBe('week');
    expect(week.points.map(p => p.value)).toEqual([887, 1179]);
    expect(week.points.map(p => p.value)).not.toContain(1180);
    for (const p of week.points) {
      expect(Date.parse(p.at!)).toBeGreaterThanOrEqual(Date.parse('2026-08-17T00:00:00Z'));
      expect(Date.parse(p.at!)).toBeLessThan(Date.parse('2026-08-24T00:00:00Z'));
    }
  });

  test('a metric that does not reset keeps its whole trajectory', async () => {
    // The mirror-image failure, from applying the rule to every metric: "net
    // 2026" accumulates all year under a market targeting 2026-12, and
    // filtering by that period emptied both charts off the floor.
    const f = await floor();
    const year = f.horizonHistories.find(h => h.targetDate === '2026-12')!;
    expect(year.resetsEvery).toBeNull();
    expect(year.points.map(p => p.value)).toEqual([137, 45_000]);
  });

  test('a period with no readings yet ships an empty series, not a stale one', async () => {
    // A week that has just begun: the honest answer is "nothing measured yet",
    // and the page draws the forecast alone.
    await db.delete(metricLogs).where(eq(metricLogs.metricId, WEEK_METRIC));
    await db.insert(metricLogs).values([
      {
        id: 'log-w-old',
        workspaceId: WS,
        metricId: WEEK_METRIC,
        metricName: 'Revenue this week (USD)',
        value: 1_180,
        timestamp: new Date('2026-08-16T10:00:00Z'),
      },
    ]);
    const f = await floor();
    const week = f.horizonHistories.find(h => h.targetDate === '2026-W34')!;
    expect(week.points).toEqual([]);
  });
});

describe('a crowded floor still describes its primary horizon', () => {
  test('the history rows are bounded from the primary end, not the soonest', async () => {
    // The payload caps how many horizons carry a history row. Capped from the
    // soonest end, a floor with five open markets left the DECISION horizon -
    // the one the page opens on - with no readings and therefore no chart.
    const extra = ['2026-09', '2026-10', '2026-11'].map((targetDate, i) => ({
      id: `mkt-coh-extra-${i}`,
      workspaceId: WS,
      metricId: YEAR_METRIC,
      metricName: 'Net 2026 (USD)',
      targetDate,
      rangeMin: 0,
      rangeMax: 150_000,
      shares: [0, 0] as [number, number],
      liquidity: 1_000,
      pool: initialPool(1_000),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
      branch: null,
    }));
    await db.insert(markets).values(extra);

    const f = await floor();
    expect(f.markets.length).toBe(5);
    const primary = f.markets[f.markets.length - 1];
    expect(primary.targetDate).toBe('2026-12');
    const row = f.horizonHistories.find(h => h.marketId === primary.marketId);
    expect(row).toBeDefined();
    expect(row!.points.length).toBeGreaterThan(0);
    expect(f.marketHistoryMarketId).toBe(primary.marketId);
  });
});

describe('the newest announcement agrees with the announcement list', () => {
  test('latestAnnouncement is the newest row, and the count is every row', async () => {
    await db.insert(announcements).values([
      { id: 'ann-old', workspaceId: WS, body: 'first disclosure', publishedAt: new Date('2026-08-01T09:00:00Z') },
      {
        id: 'ann-new',
        workspaceId: WS,
        body: 'the one a trader must not miss',
        publishedAt: new Date('2026-08-16T09:00:00Z'),
      },
    ]);
    const f = await floor();
    // Inline for the first paint, so it has to be the SAME row the list route
    // puts on top; a stale or second-newest inline copy is a disclosure the
    // reader thinks they have seen.
    const list = await request(app).get(`/api/marketplace/${WS}/announcements`);
    expect(list.body.announcements[0].id).toBe(f.latestAnnouncement?.id);
    expect(f.latestAnnouncement?.id).toBe('ann-new');
    expect(f.announcementCount).toBe(list.body.announcements.length);
  });

  test('a floor with nothing announced says so rather than omitting the field', async () => {
    const f = await floor();
    // null, not undefined: undefined is what the counts-only boundary means,
    // and a reader cannot tell "nothing announced" from "not allowed to see"
    // if the two look the same.
    expect(f.latestAnnouncement).toBeNull();
    expect(f.announcementCount).toBe(0);
  });
});

describe('the private boundary still holds', () => {
  test('a floor whose Public group cannot read ships no history at all', async () => {
    const [publicGroup] = await db
      .select()
      .from(permissionGroups)
      .where(and(eq(permissionGroups.workspaceId, WS), eq(permissionGroups.type, 'public')));
    await db.update(permissionGroups).set({ capabilities: [] }).where(eq(permissionGroups.id, publicGroup.id));

    const res = await request(app).get(`/api/marketplace/${WS}`);
    expect(res.status).toBe(200);
    for (const key of [
      'marketHistory',
      'marketHistoryMarketId',
      'horizonHistories',
      'heroHistory',
      'proposals',
      'latestAnnouncement',
      'announcementCount',
    ]) {
      expect(res.body[key]).toBeUndefined();
    }
    // The counts-only surface survives, so the marketplace card still works.
    expect(res.body.openMarketCount).toBeGreaterThan(0);
  });
});
