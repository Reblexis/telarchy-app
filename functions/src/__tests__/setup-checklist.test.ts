/**
 * What a floor's checklist says, read from the rows (owner direction
 * 2026-08-23).
 *
 * Two failures this is built against. The first is a checklist that reports a
 * default as a decision: telling an operator they have settled a question they
 * have never read is worse than not asking. The second is the one that already
 * bites in production: a metric created without funding opens a market holding
 * ZERO liquidity, which renders perfectly and refuses every trade. That has to
 * come out as blocking, in those words, or an operator walks away believing
 * they have a live market.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import {
  agents,
  announcements,
  markets,
  metrics,
  permissionGroups,
  proposals,
  sources,
  trades,
  workspaces,
} from '../db/schema';
import { initialPool } from '../lib/amm';
import { toUnits } from '../lib/validation';
import { buildChecklist } from '../services/setup-checklist';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const OWNER = 'agent-owner-checklist';
const OUTSIDER = 'agent-outsider';
const WS = 'ws-checklist';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-own', balance: toUnits(1000) },
    { id: OUTSIDER, apiKeyHash: 'h-out', balance: toUnits(1000) },
  ]);
  await db.insert(workspaces).values({
    id: WS,
    name: 'Kleros',
    slug: 'kleros',
    createdBy: OWNER,
    visibility: 'unlisted',
  });
  await db.insert(permissionGroups).values({
    id: 'grp-public',
    workspaceId: WS,
    name: 'Public',
    type: 'public',
    memberIds: [],
    permissions: {},
    capabilities: ['read'],
  });
});

/** A metric with a horizon, and the market that comes with it. */
async function seedNumber(opts: { liquidity?: number; description?: string } = {}) {
  await db.insert(metrics).values({
    id: 'metric-1',
    workspaceId: WS,
    name: 'Monthly disputes arbitrated',
    description: opts.description ?? 'Counted on-chain from the arbitrator proposal.',
    value: 0,
    formula: '',
    marketRangeMax: 5000,
    timePreference: { enabled: false, halfLife: 1, customHorizons: ['2026-09'] },
  });
  const b = opts.liquidity ?? 0;
  await db.insert(markets).values({
    id: 'mkt-1',
    workspaceId: WS,
    metricId: 'metric-1',
    metricName: 'Monthly disputes arbitrated',
    targetDate: '2026-09',
    rangeMin: 0,
    rangeMax: 5000,
    shares: [0, 0],
    liquidity: b,
    pool: initialPool(b),
    active: true,
    resolved: false,
    voided: false,
  });
}

const itemOf = (c: Awaited<ReturnType<typeof buildChecklist>>, id: string) => c.items.find(i => i.id === id)!;

describe('a floor with nothing on it', () => {
  test('every decision is open, and the missing number blocks', async () => {
    const c = await buildChecklist(WS);
    expect(c.items.every(i => i.status === 'open')).toBe(true);
    expect(c.blocking[0]).toMatch(/no number/i);
  });

  test('an unknown workspace answers empty rather than throwing', async () => {
    const c = await buildChecklist('ws-nope');
    expect(c.workspace).toBeNull();
    expect(c.items).toEqual([]);
  });
});

describe('the number', () => {
  test('a metric with no horizon is not a market, and says so', async () => {
    await db.insert(metrics).values({
      id: 'metric-flat',
      workspaceId: WS,
      name: 'Revenue',
      description: 'x',
      value: 0,
      formula: '',
      marketRangeMax: 1000,
      timePreference: null,
    });
    const c = await buildChecklist(WS);
    expect(itemOf(c, 'number').status).toBe('open');
    expect(itemOf(c, 'number').note).toMatch(/none with a horizon/);
    expect(c.blocking.join(' ')).toMatch(/no horizon/);
  });

  test('a metric with no definition is open, because that text is what settles', async () => {
    await seedNumber({ description: '', liquidity: 100 });
    expect(itemOf(await buildChecklist(WS), 'number').note).toMatch(/nothing says what the number counts/);
  });

  test('a described metric with a horizon is settled', async () => {
    await seedNumber({ liquidity: 100 });
    expect(itemOf(await buildChecklist(WS), 'number').status).toBe('done');
  });
});

describe('liquidity, which is the one that looks fine and is not', () => {
  test('a market holding zero blocks, in the words that say why', async () => {
    await seedNumber({ liquidity: 0 });
    const c = await buildChecklist(WS);
    expect(itemOf(c, 'liquidity').status).toBe('open');
    expect(c.blocking.join(' ')).toMatch(/every trade against them is refused/i);
  });

  test('a token amount is not funded, it is a decoration', async () => {
    // What a workspace auto-funds per market: 0.5 credits, so b = 0.72. It is
    // NOT zero, so every trade is accepted, and measured on beta the first
    // 5-credit trade moved the forecast from 2500 to 4997 on a 0-5000 band.
    // Reporting that as settled is how an operator ends up trusting a number
    // anyone can pin for pocket change.
    await seedNumber({ liquidity: 0.5 / Math.LN2 });
    const c = await buildChecklist(WS);
    expect(itemOf(c, 'liquidity').status).toBe('open');
    expect(itemOf(c, 'liquidity').note).toMatch(/decoration/);
    expect(c.blocking.join(' ')).toMatch(/the price will mean nothing/);
  });

  test('a market deep enough to survive a shove reports what is behind it', async () => {
    // b = 721.35 is 500 credits of pool: b = pool / ln 2.
    await seedNumber({ liquidity: 721.35 });
    const c = await buildChecklist(WS);
    expect(itemOf(c, 'liquidity').status).toBe('done');
    expect(itemOf(c, 'liquidity').note).toMatch(/^500 credits/);
    expect(c.blocking.join(' ')).not.toMatch(/mean nothing/);
  });
});

describe('decisions that a default must never be mistaken for', () => {
  test('a read-only Public group is not "who can trade" decided', async () => {
    await seedNumber({ liquidity: 100 });
    const c = await buildChecklist(WS);
    expect(itemOf(c, 'participation').status).toBe('open');
    expect(c.blocking.join(' ')).toMatch(/can only watch/);
  });

  test('granting trade settles it', async () => {
    await db.update(permissionGroups).set({ capabilities: ['read', 'trade'] });
    expect(itemOf(await buildChecklist(WS), 'participation').status).toBe('done');
  });

  test('private is a real answer, not an unanswered question', async () => {
    await db.update(workspaces).set({ visibility: 'private' });
    expect(itemOf(await buildChecklist(WS), 'participation').status).toBe('done');
  });

  test('auto-funding off with no funded proposal is not a proposal policy', async () => {
    expect(itemOf(await buildChecklist(WS), 'contracts').status).toBe('open');
  });

  test('auto-funding a real amount is', async () => {
    await db.update(workspaces).set({ autoFundNewMarkets: true, newMarketLiquidityCredits: 25 });
    const c = await buildChecklist(WS);
    expect(itemOf(c, 'contracts').status).toBe('done');
    expect(itemOf(c, 'contracts').note).toMatch(/25 credits/);
  });

  test('auto-funding the workspace default is not a proposal policy either', async () => {
    // 0.5 per market is what workspace creation sets, and it prices nothing.
    await db.update(workspaces).set({ autoFundNewMarkets: true, newMarketLiquidityCredits: 0.5 });
    const c = await buildChecklist(WS);
    expect(itemOf(c, 'contracts').status).toBe('open');
    expect(itemOf(c, 'contracts').note).toMatch(/too thin to price anything/);
  });
});

describe('the rest of the specification', () => {
  test('a source or a key means something can keep the number true', async () => {
    await seedNumber({ liquidity: 10 });
    expect(itemOf(await buildChecklist(WS), 'updates').status).toBe('open');
    await db.insert(sources).values({ id: 'src-1', workspaceId: WS, name: 'Subgraph', type: 'text' });
    expect(itemOf(await buildChecklist(WS), 'updates').status).toBe('done');
  });

  test('a charter settles what the price is for', async () => {
    expect(itemOf(await buildChecklist(WS), 'decisions').status).toBe('open');
    await db.update(workspaces).set({ charter: 'I read the price before I ship.' });
    expect(itemOf(await buildChecklist(WS), 'decisions').status).toBe('done');
  });

  test('a decided proposal counts even with no charter', async () => {
    await db.insert(proposals).values({
      id: 'p-1',
      workspaceId: WS,
      proposedBy: OUTSIDER,
      title: 'Do a thing',
      description: 'x',
      status: 'approved',
      conditionalMarketIds: [],
      createdAt: new Date(),
    });
    expect(itemOf(await buildChecklist(WS), 'decisions').status).toBe('done');
  });

  test('published context counts whichever way it was published', async () => {
    expect(itemOf(await buildChecklist(WS), 'context').status).toBe('open');
    await db.insert(announcements).values({
      id: 'ann-1',
      workspaceId: WS,
      body: 'We shipped the bridge.',
      publishedAt: new Date(),
    });
    expect(itemOf(await buildChecklist(WS), 'context').status).toBe('done');
  });

  test('reach is somebody other than the owner trading', async () => {
    await seedNumber({ liquidity: 100 });
    expect(itemOf(await buildChecklist(WS), 'reach').status).toBe('open');
    await db.insert(trades).values({
      id: 't-1',
      workspaceId: WS,
      agentId: OWNER,
      marketId: 'mkt-1',
      direction: 'higher',
      shares: 1,
      cost: 1,
      createdAt: new Date(),
    });
    // The owner trading on their own floor is not reach.
    expect(itemOf(await buildChecklist(WS), 'reach').status).toBe('open');
    await db.insert(trades).values({
      id: 't-2',
      workspaceId: WS,
      agentId: OUTSIDER,
      marketId: 'mkt-1',
      direction: 'higher',
      shares: 1,
      cost: 1,
      createdAt: new Date(),
    });
    expect(itemOf(await buildChecklist(WS), 'reach').status).toBe('done');
  });
});

describe('the vocabulary a reader gets', () => {
  test('no item says "floor", because the rail renders these words', async () => {
    // docs/ui-conventions.md, owner 2026-08-14: user-facing copy says MARKET.
    // The checklist's labels and notes render beside the conversation and go
    // into the prompt the operator pastes, so they are user-facing.
    await seedNumber({ liquidity: 0.5 / Math.LN2 });
    const c = await buildChecklist(WS);
    const text = [...c.blocking, ...c.items.flatMap(i => [i.label, i.note, i.question, i.why, ...i.options])].join(' ');
    expect(text).not.toMatch(/floor/i);
  });
});

describe('what the page draws', () => {
  test('nothing to draw before a market exists', async () => {
    expect((await buildChecklist(WS)).market).toBeNull();
  });

  test('the market summary is the row, not an illustration of it', async () => {
    await seedNumber({ liquidity: 721.35 });
    const m = (await buildChecklist(WS)).market!;
    expect(m.metricName).toBe('Monthly disputes arbitrated');
    expect(m.rangeMax).toBe(5000);
    expect(m.targetDate).toBe('2026-09');
    // Untouched book sits in the middle of the band.
    expect(m.consensus).toBe(2500);
    expect(m.pool).toBe(500);
  });

  test('a market holding nothing predicts nothing, and says so with a null', async () => {
    // The hero draws a ghost from this: a band with no needle to place, which
    // is the honest picture of a market that cannot be traded.
    await seedNumber({ liquidity: 0 });
    const m = (await buildChecklist(WS)).market!;
    expect(m.consensus).toBeNull();
    expect(m.pool).toBe(0);
  });

  test('the soonest horizon is the one drawn', async () => {
    await seedNumber({ liquidity: 100 });
    await db.insert(markets).values({
      id: 'mkt-later',
      workspaceId: WS,
      metricId: 'metric-1',
      metricName: 'Monthly disputes arbitrated',
      targetDate: '2027-03',
      rangeMin: 0,
      rangeMax: 5000,
      shares: [0, 0],
      liquidity: 100,
      pool: initialPool(100),
      active: true,
      resolved: false,
      voided: false,
    });
    expect((await buildChecklist(WS)).market!.targetDate).toBe('2026-09');
  });
});
