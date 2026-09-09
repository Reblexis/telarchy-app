/**
 * The window (docs/data-room.md, "The window is the rows behind the next
 * reading"): the rows that already determine part of each priced number's
 * next reading, published one unit at a time.
 *
 * What is pinned here is the promise the block makes to a forecaster:
 *
 * 1. It publishes ROWS, not a count of rows. One entry per verified
 *    participant, one per counted trader, one per participant with a marked
 *    position, one per undecided proposal, one per payment.
 * 2. Its rows and the metric beside them cannot disagree: the entries at or
 *    above each threshold are exactly the number the pulse publishes.
 * 3. It names nobody. A participant is an entry in a sorted list of numbers.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

const marked = jest.fn(async (): Promise<Map<string, number>> => new Map());
jest.mock('../lib/board', () => ({
  loadSeasonMarked: (...args: unknown[]) => marked(...(args as [])),
}));

import { agents, earnClaims, liquidityPurchases, proposals, trades, workspaces } from '../db/schema';
import { MANIFOLD_PAID_KEY, WEEKLY_TRADER_MIN_CREDITS } from '../services/platform-stats';
import { buildTraderWindow } from '../services/trader-window';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const NOW = new Date('2026-09-09T12:00:00.000Z');
const days = (n: number) => n * 24 * 60 * 60 * 1000;

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);

beforeEach(async () => {
  await truncateAll();
  marked.mockReset();
  marked.mockResolvedValue(new Map());
  await db.insert(agents).values([
    { id: 'v1', apiKeyHash: 'h1', balance: 0 },
    { id: 'v2', apiKeyHash: 'h2', balance: 0 },
    { id: 'v3', apiKeyHash: 'h3', balance: 0 },
    { id: 'unverified', apiKeyHash: 'h4', balance: 0 },
    { id: 'house', apiKeyHash: 'h5', balance: 0, platformAdmin: true },
    { id: 'outsider', apiKeyHash: 'h6', balance: 0 },
  ]);
  await db.insert(workspaces).values([
    { id: 'ws-telarchy', name: 'Telarchy', slug: 'telarchy', createdBy: 'house', visibility: 'public' },
    { id: 'ws-out', name: 'Pinecast', slug: 'pinecast', createdBy: 'outsider', visibility: 'public' },
    { id: 'ws-shut', name: 'Private', slug: 'private-one', createdBy: 'outsider', visibility: 'private' },
  ]);
});

/** A participant we paid for a Manifold record: the verified set. */
async function verify(...ids: string[]) {
  await db.insert(earnClaims).values(
    ids.map(id => ({
      id: `claim-${id}`,
      agentId: id,
      key: MANIFOLD_PAID_KEY,
      credits: 0,
    })),
  );
}

/** One trade, `credits` of absolute cost, `ago` days before NOW. */
async function trade(id: string, agentId: string, credits: number, ago: number) {
  await db.insert(trades).values({
    id,
    workspaceId: 'ws-telarchy',
    agentId,
    marketId: 'mkt',
    direction: 'higher',
    shares: 1,
    cost: credits,
    createdAt: new Date(NOW.getTime() - days(ago)),
  });
}

describe('the traders block publishes one entry per verified participant', () => {
  test('every verified participant appears, sorted high to low, zeroes included', async () => {
    await verify('v1', 'v2', 'v3');
    await trade('t1', 'v1', 40, 1);
    await trade('t2', 'v2', 900, 2);
    const w = await buildTraderWindow(NOW);
    expect(w.traders.spend).toEqual([900, 40, 0]);
  });

  test('a participant with no paid record is not in the list at all', async () => {
    await verify('v1');
    await trade('t1', 'unverified', 5_000, 1);
    const w = await buildTraderWindow(NOW);
    expect(w.traders.spend).toEqual([0]);
  });

  test('a sell counts as activity, the same as a buy', async () => {
    await verify('v1');
    await trade('t1', 'v1', -150, 1);
    const w = await buildTraderWindow(NOW);
    expect(w.traders.spend).toEqual([150]);
  });

  test('trades older than the window are not in the spend', async () => {
    await verify('v1');
    await trade('old', 'v1', 500, 8);
    await trade('new', 'v1', 25, 1);
    const w = await buildTraderWindow(NOW);
    expect(w.traders.spend).toEqual([25]);
  });

  test('the entries at or above the threshold are the counted traders, and the threshold is the metric’s own', async () => {
    expect(WEEKLY_TRADER_MIN_CREDITS).toBe(100);
    await verify('v1', 'v2', 'v3');
    await trade('t1', 'v1', 100, 1);
    await trade('t2', 'v2', 99.99, 1);
    await trade('t3', 'v3', 4_200, 3);
    const w = await buildTraderWindow(NOW);
    expect(w.traders.threshold).toBe(WEEKLY_TRADER_MIN_CREDITS);
    expect(w.traders.spend.filter(v => v >= w.traders.threshold)).toHaveLength(2);
  });
});

describe('the lapse is the day a counted trader falls out of their own window', () => {
  test('a trader whose only trades are seven days old lapses tomorrow', async () => {
    await verify('v1');
    // 6.5 days old: on this time tomorrow the trailing week no longer holds it.
    await db.insert(trades).values({
      id: 't1',
      workspaceId: 'ws-telarchy',
      agentId: 'v1',
      marketId: 'mkt',
      direction: 'higher',
      shares: 1,
      cost: 100,
      createdAt: new Date(NOW.getTime() - days(6.5)),
    });
    const w = await buildTraderWindow(NOW);
    expect(w.traders.lapses).toEqual(['2026-09-10']);
  });

  test('a trader who traded today holds the count for the whole seven days', async () => {
    await verify('v1');
    await trade('t1', 'v1', 250, 0);
    const w = await buildTraderWindow(NOW);
    expect(w.traders.lapses).toEqual(['2026-09-16']);
  });

  test('only what is still above the threshold holds it: a trader whose old half falls away lapses then', async () => {
    await verify('v1');
    await trade('old', 'v1', 80, 6); // leaves the window in one day
    await trade('new', 'v1', 40, 1); // 40 alone is under the threshold
    const w = await buildTraderWindow(NOW);
    expect(w.traders.lapses).toEqual(['2026-09-10']);
  });

  test('one lapse per counted trader, and nobody under the threshold has one', async () => {
    await verify('v1', 'v2');
    await trade('t1', 'v1', 300, 0);
    await trade('t2', 'v2', 10, 0);
    const w = await buildTraderWindow(NOW);
    expect(w.traders.spend).toEqual([300, 10]);
    expect(w.traders.lapses).toHaveLength(1);
  });
});

describe('the forecasters block publishes the profit distribution', () => {
  test('one entry per participant, sorted high to low, losses included', async () => {
    marked.mockResolvedValue(
      new Map([
        ['v1', 40],
        ['v2', 860.4],
        ['v3', -120],
      ]),
    );
    const w = await buildTraderWindow(NOW);
    expect(w.forecasters.profit).toEqual([860, 40, -120]);
  });

  test('house accounts are not in the distribution', async () => {
    marked.mockResolvedValue(
      new Map([
        ['house', 10_000],
        ['v1', 5],
      ]),
    );
    const w = await buildTraderWindow(NOW);
    expect(w.forecasters.profit).toEqual([5]);
  });

  test('the entries at or above the threshold are the profitable forecasters', async () => {
    marked.mockResolvedValue(
      new Map([
        ['v1', 100],
        ['v2', 99],
        ['v3', 1_000],
      ]),
    );
    const w = await buildTraderWindow(NOW);
    expect(w.forecasters.threshold).toBe(100);
    expect(w.forecasters.profit.filter(v => v >= w.forecasters.threshold)).toHaveLength(2);
  });
});

describe('the owners block publishes what is still undecided', () => {
  test('one row per public workspace holding an undecided proposal, with its deadline', async () => {
    await db.insert(proposals).values([
      {
        id: 'p1',
        workspaceId: 'ws-out',
        proposedBy: 'v1',
        title: 'Raise the paid tier to $9',
        status: 'pending',
        decideBy: new Date('2026-09-14T00:00:00.000Z'),
      },
    ]);
    const w = await buildTraderWindow(NOW);
    expect(w.owners.pending).toEqual([
      { slug: 'pinecast', title: 'Raise the paid tier to $9', decideBy: '2026-09-14' },
    ]);
  });

  test('a decided proposal is not pending, and a private workspace is not published at all', async () => {
    await db.insert(proposals).values([
      { id: 'p1', workspaceId: 'ws-out', proposedBy: 'v1', title: 'Done', status: 'approved' },
      { id: 'p2', workspaceId: 'ws-shut', proposedBy: 'v1', title: 'Hidden', status: 'pending' },
    ]);
    const w = await buildTraderWindow(NOW);
    expect(w.owners.pending).toEqual([]);
  });

  test('a house floor is not an outside owner, so its ballot is not in this block', async () => {
    await db
      .insert(proposals)
      .values([{ id: 'p1', workspaceId: 'ws-telarchy', proposedBy: 'v1', title: 'Ours', status: 'pending' }]);
    const w = await buildTraderWindow(NOW);
    expect(w.owners.pending).toEqual([]);
  });
});

describe('the revenue block publishes the payments themselves', () => {
  test('one row per payment in the window, completed or not, with amount, status and date', async () => {
    await db.insert(liquidityPurchases).values([
      {
        id: 'lp1',
        workspaceId: 'ws-out',
        agentId: 'outsider',
        usdAmount: 49,
        credits: 4900,
        creditsPerUsd: 100,
        status: 'pending',
        createdAt: new Date(NOW.getTime() - days(3)),
      },
      {
        id: 'lp2',
        workspaceId: 'ws-out',
        agentId: 'outsider',
        usdAmount: 5,
        credits: 500,
        creditsPerUsd: 100,
        status: 'completed',
        createdAt: new Date(NOW.getTime() - days(2)),
        completedAt: new Date(NOW.getTime() - days(2)),
      },
    ]);
    const w = await buildTraderWindow(NOW);
    expect(w.revenue.payments).toEqual([
      { usd: 5, status: 'completed', at: '2026-09-07' },
      { usd: 49, status: 'pending', at: '2026-09-06' },
    ]);
  });

  test('the house paying itself is not revenue and is not published as one', async () => {
    await db.insert(liquidityPurchases).values([
      {
        id: 'lp1',
        workspaceId: 'ws-telarchy',
        agentId: 'house',
        usdAmount: 20,
        credits: 2000,
        creditsPerUsd: 100,
        status: 'completed',
        createdAt: new Date(NOW.getTime() - days(1)),
        completedAt: new Date(NOW.getTime() - days(1)),
      },
    ]);
    const w = await buildTraderWindow(NOW);
    expect(w.revenue.payments).toEqual([]);
  });

  test('a payment older than the thirty day window is out of it', async () => {
    await db.insert(liquidityPurchases).values([
      {
        id: 'lp1',
        workspaceId: 'ws-out',
        agentId: 'outsider',
        usdAmount: 9,
        credits: 900,
        creditsPerUsd: 100,
        status: 'completed',
        createdAt: new Date(NOW.getTime() - days(40)),
        completedAt: new Date(NOW.getTime() - days(40)),
      },
    ]);
    const w = await buildTraderWindow(NOW);
    expect(w.revenue.payments).toEqual([]);
  });
});

describe('the block names nobody', () => {
  test('no participant id appears anywhere in it', async () => {
    await verify('v1', 'v2');
    await trade('t1', 'v1', 400, 1);
    marked.mockResolvedValue(
      new Map([
        ['v1', 500],
        ['v2', -20],
      ]),
    );
    await db
      .insert(proposals)
      .values([{ id: 'p1', workspaceId: 'ws-out', proposedBy: 'v1', title: 'A job', status: 'pending' }]);
    await db.insert(liquidityPurchases).values([
      {
        id: 'lp1',
        workspaceId: 'ws-out',
        agentId: 'outsider',
        usdAmount: 49,
        credits: 4900,
        creditsPerUsd: 100,
        status: 'pending',
        createdAt: NOW,
      },
    ]);
    const json = JSON.stringify(await buildTraderWindow(NOW));
    for (const id of ['v1', 'v2', 'outsider', 'house']) expect(json).not.toContain(id);
    // The one identity it does carry is a public workspace's own slug.
    expect(json).toContain('pinecast');
  });
});
