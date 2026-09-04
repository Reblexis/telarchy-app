/**
 * What each date opens with, decided per date on the metric's sheet
 * (docs/owner-on-the-floor.md, dialog 2; docs/guides/proposals.md, "Or
 * decide it once, per date"; owner decision 2026-09-04 in the telarchy
 * umbrella, notes/proposal-liquidity-per-metric-2026-09-04.md).
 *
 * The rule the feature exists to enforce, in the owner's words: a proposal
 * is the proposer's to fund. The owner pays for a proposal's branch only on
 * a date where they chose a number, and the workspace-wide auto-fund never
 * touches a proposal.
 */
jest.mock('../db/client', () => require('./harness/test-db'));

import { and, eq } from 'drizzle-orm';
import { agents, liquidityEvents, markets, metrics as metricsTable, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { toAbsoluteDate } from '../lib/date-utils';
import { fromUnits, toUnits } from '../lib/validation';
import { parseTimePreference } from '../routes/metrics';
import { insertPendingMarkets } from '../services/markets';
import { createConditionalMarkets } from '../services/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-hc';
const OWNER = 'owner-hc';
const PROPOSER = 'proposer-hc';
const M_A = 'metric-hc-a';
const M_B = 'metric-hc-b';
const DEC = '2030-12';
const NOV = '2030-11';

type HorizonCredits = Record<string, { book?: number | null; proposal?: number }>;

async function seed(opts: {
  ownerBalance?: number;
  ownerWallet?: number;
  autoFund?: boolean;
  aCredits?: HorizonCredits;
  aHorizons?: string[];
  aStanding?: number | null;
  bCredits?: HorizonCredits;
}) {
  await db.insert(agents).values([
    {
      id: OWNER,
      apiKeyHash: 'h-hc-owner',
      balance: toUnits(opts.ownerBalance ?? 1000),
      liquidityBalance: toUnits(opts.ownerWallet ?? 0),
    },
    { id: PROPOSER, apiKeyHash: 'h-hc-proposer', balance: toUnits(1000) },
  ]);
  await db.insert(workspaces).values({
    id: WS,
    name: 'Horizon credits',
    createdBy: OWNER,
    visibility: 'private',
    autoFundNewMarkets: opts.autoFund ?? true,
    newMarketLiquidityCredits: 100,
  });
  await db.insert(metricsTable).values([
    {
      id: M_A,
      workspaceId: WS,
      name: 'Metric A',
      value: 50,
      formula: '0',
      marketRangeMax: 100,
      liquidityCredits: opts.aStanding ?? null,
      timePreference: {
        enabled: false,
        halfLife: 1,
        customHorizons: opts.aHorizons ?? [DEC],
        ...(opts.aCredits ? { horizonCredits: opts.aCredits } : {}),
      },
    },
    {
      id: M_B,
      workspaceId: WS,
      name: 'Metric B',
      value: 50,
      formula: '0',
      marketRangeMax: 100,
      timePreference: {
        enabled: false,
        halfLife: 1,
        customHorizons: [DEC],
        ...(opts.bCredits ? { horizonCredits: opts.bCredits } : {}),
      },
    },
  ]);
}

async function baseline(id: string, metricId: string, targetDate: string) {
  await db.insert(markets).values({
    id,
    workspaceId: WS,
    metricId,
    metricName: metricId,
    targetDate,
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 10,
    pool: initialPool(10),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    branch: null,
  });
}

async function proposal(id: string) {
  await db.insert(proposals).values({
    id,
    workspaceId: WS,
    proposedBy: PROPOSER,
    title: `proposal ${id}`,
    description: '',
    status: 'pending',
    conditionalMarketIds: [],
    liquiditySubsidy: 0,
  });
}

const branches = async (proposalId: string) =>
  db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.proposalId, proposalId)));

const ownerBalance = async () => {
  const [o] = await db.select().from(agents).where(eq(agents.id, OWNER));
  return { balance: fromUnits(o.balance as number), wallet: fromUnits(o.liquidityBalance as number) };
};

describe('the field on the metric', () => {
  const tp = (extra: Record<string, unknown>) =>
    parseTimePreference({ enabled: false, halfLife: 1, customHorizons: ['+0w', DEC], ...extra });

  test('horizonCredits is kept, keyed by the entry, with book and proposal', () => {
    const out = tp({ horizonCredits: { '+0w': { book: 500, proposal: 250 }, [DEC]: { proposal: 0 } } });
    expect(out).not.toBeInstanceOf(Error);
    expect((out as { horizonCredits?: HorizonCredits }).horizonCredits).toEqual({
      '+0w': { book: 500, proposal: 250 },
      [DEC]: { proposal: 0 },
    });
  });

  test('a key that names no entry is dropped, never stored', () => {
    const out = tp({ horizonCredits: { '+3m': { book: 500 }, '+0w': { proposal: 1 } } });
    expect((out as { horizonCredits?: HorizonCredits }).horizonCredits).toEqual({ '+0w': { proposal: 1 } });
  });

  test('book may be null, meaning the fallback; proposal may be 0, meaning the proposer pays', () => {
    const out = tp({ horizonCredits: { '+0w': { book: null, proposal: 0 } } });
    expect((out as { horizonCredits?: HorizonCredits }).horizonCredits).toEqual({ '+0w': { book: null, proposal: 0 } });
  });

  test('a negative or non-numeric number is refused', () => {
    expect(tp({ horizonCredits: { '+0w': { book: -1 } } })).toBeInstanceOf(Error);
    expect(tp({ horizonCredits: { '+0w': { proposal: 'lots' } } })).toBeInstanceOf(Error);
    expect(tp({ horizonCredits: { '+0w': { proposal: Number.NaN } } })).toBeInstanceOf(Error);
    expect(tp({ horizonCredits: 'no' })).toBeInstanceOf(Error);
  });

  test('absent or empty horizonCredits stores nothing', () => {
    expect((tp({}) as { horizonCredits?: HorizonCredits }).horizonCredits).toBeUndefined();
    expect((tp({ horizonCredits: {} }) as { horizonCredits?: HorizonCredits }).horizonCredits).toBeUndefined();
  });
});

describe("the metric's own book opens with its date's number", () => {
  const pending = (list: Array<[string, string, string]>) =>
    list.map(([marketId, metricId, targetDate]) => ({
      marketId,
      metricId,
      metricName: metricId,
      targetDate,
      rangeMax: 100,
    }));

  test('book on the date beats the metric standing number and the workspace default', async () => {
    await seed({ aCredits: { [DEC]: { book: 300 } }, aStanding: 200 });
    await insertPendingMarkets(pending([['mk-a-dec', M_A, DEC]]), WS);
    const [m] = await db.select().from(markets).where(eq(markets.id, 'mk-a-dec'));
    expect(m.pool).toBeCloseTo(300, 6);
    expect((await ownerBalance()).balance).toBeCloseTo(700, 6);
  });

  test('a date with no book number falls back to the metric standing number, then the workspace default', async () => {
    await seed({ aCredits: { [DEC]: { book: null, proposal: 5 } }, aStanding: 200 });
    await insertPendingMarkets(
      pending([
        ['mk-a-dec', M_A, DEC],
        ['mk-b-dec', M_B, DEC],
      ]),
      WS,
    );
    const rows = await db.select().from(markets).where(eq(markets.workspaceId, WS));
    expect(rows.find(r => r.id === 'mk-a-dec')?.pool).toBeCloseTo(200, 6);
    expect(rows.find(r => r.id === 'mk-b-dec')?.pool).toBeCloseTo(100, 6);
  });

  test('a rolling entry is matched by the date it resolves to today', async () => {
    const thisMonth = toAbsoluteDate('+0m', new Date());
    await seed({ aHorizons: ['+0m'], aCredits: { '+0m': { book: 42 } } });
    await insertPendingMarkets(pending([['mk-a-now', M_A, thisMonth]]), WS);
    const [m] = await db.select().from(markets).where(eq(markets.id, 'mk-a-now'));
    expect(m.pool).toBeCloseTo(42, 6);
  });

  test('book 0 on a date opens that book unfunded and charges nothing for it', async () => {
    await seed({ aCredits: { [DEC]: { book: 0 } } });
    await insertPendingMarkets(pending([['mk-a-dec', M_A, DEC]]), WS);
    const [m] = await db.select().from(markets).where(eq(markets.id, 'mk-a-dec'));
    expect(m.pool).toBe(0);
    expect((await ownerBalance()).balance).toBeCloseTo(1000, 6);
  });
});

describe('a proposal is the proposer to fund', () => {
  test('the workspace auto-fund never covers a proposal: with no number on the date, the pair opens unfunded', async () => {
    await seed({ autoFund: true });
    await baseline('base-a', M_A, DEC);
    await proposal('p1');
    await createConditionalMarkets('p1', WS, {});
    const rows = await branches('p1');
    expect(rows).toHaveLength(2);
    for (const m of rows) expect(m.pool).toBe(0);
    expect((await ownerBalance()).balance).toBeCloseTo(1000, 6);
  });

  test("the date's proposal number funds each branch from the owner", async () => {
    await seed({ aCredits: { [DEC]: { proposal: 250 } } });
    await baseline('base-a', M_A, DEC);
    await proposal('p1');
    await createConditionalMarkets('p1', WS, {});
    const rows = await branches('p1');
    expect(rows).toHaveLength(2);
    for (const m of rows) expect(m.pool).toBeCloseTo(250, 6);
    expect((await ownerBalance()).balance).toBeCloseTo(500, 6);
    const events = await db.select().from(liquidityEvents).where(eq(liquidityEvents.workspaceId, WS));
    expect(events.filter(e => e.type === 'proposal-subsidy' && e.agentId === OWNER)).toHaveLength(2);
  });

  test('two dates, two bills: each branch pair opens with its own date number', async () => {
    await seed({ aHorizons: [NOV, DEC], aCredits: { [NOV]: { proposal: 0 }, [DEC]: { proposal: 100 } } });
    await baseline('base-a-nov', M_A, NOV);
    await baseline('base-a-dec', M_A, DEC);
    await proposal('p1');
    await createConditionalMarkets('p1', WS, {});
    const rows = await branches('p1');
    expect(rows).toHaveLength(4);
    for (const m of rows.filter(r => r.targetDate === NOV)) expect(m.pool).toBe(0);
    for (const m of rows.filter(r => r.targetDate === DEC)) expect(m.pool).toBeCloseTo(100, 6);
    expect((await ownerBalance()).balance).toBeCloseTo(800, 6);
  });

  test('a metric with a number and a metric without, on the same date, bill differently', async () => {
    await seed({ aCredits: { [DEC]: { proposal: 60 } } });
    await baseline('base-a', M_A, DEC);
    await baseline('base-b', M_B, DEC);
    await proposal('p1');
    await createConditionalMarkets('p1', WS, {});
    const rows = await branches('p1');
    for (const m of rows.filter(r => r.metricId === M_A)) expect(m.pool).toBeCloseTo(60, 6);
    for (const m of rows.filter(r => r.metricId === M_B)) expect(m.pool).toBe(0);
  });

  test('the proposer subsidy wins over the date number, and the owner pays nothing', async () => {
    await seed({ aCredits: { [DEC]: { proposal: 250 } } });
    await baseline('base-a', M_A, DEC);
    await proposal('p1');
    await createConditionalMarkets('p1', WS, { contributions: { [PROPOSER]: 20 }, strict: true });
    const rows = await branches('p1');
    for (const m of rows) expect(m.pool).toBeCloseTo(20, 6);
    expect((await ownerBalance()).balance).toBeCloseTo(1000, 6);
  });

  test('an owner short of the bill gives every branch the same share of what it asked for', async () => {
    // 300 against 250 + 250 + 100 + 100 = 700: each branch gets 3/7 of its number.
    await seed({
      ownerBalance: 300,
      aHorizons: [NOV, DEC],
      aCredits: { [NOV]: { proposal: 250 }, [DEC]: { proposal: 100 } },
    });
    await baseline('base-a-nov', M_A, NOV);
    await baseline('base-a-dec', M_A, DEC);
    await proposal('p1');
    await createConditionalMarkets('p1', WS, {});
    const rows = await branches('p1');
    for (const m of rows.filter(r => r.targetDate === NOV)) expect(m.pool).toBeCloseTo((250 * 300) / 700, 4);
    for (const m of rows.filter(r => r.targetDate === DEC)) expect(m.pool).toBeCloseTo((100 * 300) / 700, 4);
    expect((await ownerBalance()).balance).toBeCloseTo(0, 4);
  });

  test('an owner with nothing leaves the pair unfunded rather than inventing credits', async () => {
    await seed({ ownerBalance: 0, aCredits: { [DEC]: { proposal: 250 } } });
    await baseline('base-a', M_A, DEC);
    await proposal('p1');
    await createConditionalMarkets('p1', WS, {});
    for (const m of await branches('p1')) expect(m.pool).toBe(0);
    expect((await ownerBalance()).balance).toBe(0);
  });

  test('the owner pays from the liquidity wallet first, then the balance', async () => {
    await seed({ ownerBalance: 100, ownerWallet: 400, aCredits: { [DEC]: { proposal: 250 } } });
    await baseline('base-a', M_A, DEC);
    await proposal('p1');
    await createConditionalMarkets('p1', WS, {});
    const after = await ownerBalance();
    expect(after.wallet).toBeCloseTo(0, 6);
    expect(after.balance).toBeCloseTo(0, 6);
    for (const m of await branches('p1')) expect(m.pool).toBeCloseTo(250, 6);
  });

  test('a later respawn for a new date reads that date number, the old pair untouched', async () => {
    await seed({ aHorizons: [NOV, DEC], aCredits: { [NOV]: { proposal: 0 }, [DEC]: { proposal: 80 } } });
    await baseline('base-a-nov', M_A, NOV);
    await proposal('p1');
    await createConditionalMarkets('p1', WS, {});
    expect((await ownerBalance()).balance).toBeCloseTo(1000, 6);
    await baseline('base-a-dec', M_A, DEC);
    await createConditionalMarkets('p1', WS, {});
    const rows = await branches('p1');
    expect(rows).toHaveLength(4);
    for (const m of rows.filter(r => r.targetDate === DEC)) expect(m.pool).toBeCloseTo(80, 6);
    for (const m of rows.filter(r => r.targetDate === NOV)) expect(m.pool).toBe(0);
    expect((await ownerBalance()).balance).toBeCloseTo(840, 6);
  });
});
