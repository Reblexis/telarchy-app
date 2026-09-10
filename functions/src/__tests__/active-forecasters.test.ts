/**
 * "Active forecasters" (docs/metrics.md): verified persons who put at least
 * 100 credits of net exposure into the markets over the trailing 7 days,
 * counting the bots they fund as themselves, house excluded.
 *
 * What is pinned here is each rule the definition exists to enforce:
 * verified means PAID for a record on ANY registry provider; net exposure,
 * not absolute cost; bots roll up to the person who funds them; the house
 * never counts; the window is seven days; a redemption is not a trade.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, authUser, earnClaims, recordLinks, trades, workspaces } from '../db/schema';
import { ACTIVE_FORECASTER_MIN_CREDITS, activeForecasters7d, paidRecordLinkAgents } from '../services/platform-stats';
import { allRecordProviders } from '../services/recordProviders';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const days = (n: number) => n * 24 * 60 * 60 * 1000;

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);

beforeEach(async () => {
  await truncateAll();
  await db.insert(authUser).values([
    { id: 'u-alice', name: 'Alice', email: 'alice@example.com' },
    { id: 'u-bob', name: 'Bob', email: 'bob@example.com' },
    { id: 'u-house', name: 'House', email: 'house@example.com' },
  ]);
  await db.insert(agents).values([
    // Two verified persons (paid claims are added per test), one unverified.
    { id: 'alice', apiKeyHash: 'h1', balance: 0, authUserId: 'u-alice' },
    { id: 'bob', apiKeyHash: 'h2', balance: 0, authUserId: 'u-bob' },
    { id: 'nobody', apiKeyHash: 'h3', balance: 0 },
    // Bots: registered from Alice's browser account, spawned by Alice's agent
    // key, a sub-bot of that spawned bot, one owned by the unverified
    // participant, and one with no owner at all.
    { id: 'alice-bot', apiKeyHash: 'h4', balance: 0, ownerUserId: 'u-alice' },
    { id: 'alice-spawn', apiKeyHash: 'h5', balance: 0, ownerAgentId: 'alice' },
    { id: 'alice-grandchild', apiKeyHash: 'h6', balance: 0, ownerAgentId: 'alice-spawn' },
    { id: 'nobody-bot', apiKeyHash: 'h7', balance: 0, ownerAgentId: 'nobody' },
    { id: 'orphan-bot', apiKeyHash: 'h8', balance: 0 },
    // The house and its bot.
    { id: 'house', apiKeyHash: 'h9', balance: 0, authUserId: 'u-house', platformAdmin: true },
    { id: 'house-bot', apiKeyHash: 'h10', balance: 0, ownerUserId: 'u-house', platformOperated: true },
  ]);
  await db.insert(workspaces).values({ id: 'ws', name: 'W', slug: 'w', createdBy: 'house', visibility: 'public' });
});

let seq = 0;
/** One trade row. `cost` is signed: a sell is negative, as the ledger stores it. */
async function trade(agentId: string, cost: number, opts: { ago?: number; kind?: string } = {}) {
  await db.insert(trades).values({
    id: `t-${++seq}`,
    workspaceId: 'ws',
    agentId,
    marketId: 'mkt',
    direction: 'higher',
    shares: cost >= 0 ? 1 : -1,
    cost,
    kind: opts.kind ?? 'trade',
    createdAt: new Date(NOW.getTime() - days(opts.ago ?? 1)),
  });
}

async function paid(agentId: string, key: string, refId = `${key}-${agentId}`) {
  await db.insert(earnClaims).values({ id: `claim-${key}-${agentId}`, agentId, key, refId, credits: 0 });
}

describe('THE RULE: verified means paid for a qualified record on any registry provider', () => {
  test('a paid Manifold record counts, and so does a paid Polymarket record', async () => {
    await paid('alice', 'manifold_link');
    await paid('bob', 'polymarket_link');
    await trade('alice', 100);
    await trade('bob', 100);
    expect(await activeForecasters7d(NOW)).toBe(2);
  });

  test('every provider in the registry is a way in, so a new provider joins by joining the registry', async () => {
    const providers = allRecordProviders();
    expect(providers.length).toBeGreaterThanOrEqual(2);
    const ids: string[] = [];
    for (const [i, p] of providers.entries()) {
      const id = `p-${i}`;
      ids.push(id);
      await db.insert(agents).values({ id, apiKeyHash: `hp${i}`, balance: 0 });
      await paid(id, p.earnKey);
      await trade(id, 100);
    }
    expect(await paidRecordLinkAgents(ids)).toEqual(new Set(ids));
    expect(await activeForecasters7d(NOW)).toBe(providers.length);
  });

  test('a record_links badge without a paid claim is identity, not verification', async () => {
    await db.insert(recordLinks).values({
      agentId: 'alice',
      provider: 'manifold',
      externalId: 'alice-on-manifold',
      handle: 'alice',
    });
    await trade('alice', 500);
    expect(await activeForecasters7d(NOW)).toBe(0);
  });

  test('a Google or GitHub sign-in, a signup grant, a daily trade or a referral is not a record', async () => {
    for (const key of ['signup_user', 'signup_oauth', 'link_oauth', 'daily_trade', 'referral', 'trade_profit']) {
      await paid('alice', key);
    }
    await trade('alice', 500);
    expect(await activeForecasters7d(NOW)).toBe(0);
  });

  test('an unverified participant never counts, however much they trade', async () => {
    await trade('nobody', 10_000);
    expect(await activeForecasters7d(NOW)).toBe(0);
  });
});

describe('THE RULE: net exposure of 100 credits, not absolute cost', () => {
  beforeEach(async () => {
    await paid('alice', 'manifold_link');
  });

  test('the line is 100 credits, and 99.99 is under it', async () => {
    expect(ACTIVE_FORECASTER_MIN_CREDITS).toBe(100);
    await trade('alice', 99.99);
    expect(await activeForecasters7d(NOW)).toBe(0);
    await trade('alice', 0.01);
    expect(await activeForecasters7d(NOW)).toBe(1);
  });

  test('a buy and its sell-back net to nothing: a round trip is not activity', async () => {
    await trade('alice', 100);
    await trade('alice', -100);
    expect(await activeForecasters7d(NOW)).toBe(0);
  });

  test('a sell reduces exposure: 150 bought and 100 sold is 50, under the line', async () => {
    await trade('alice', 150);
    await trade('alice', -100);
    expect(await activeForecasters7d(NOW)).toBe(0);
  });

  test('exposure adds across trades and markets', async () => {
    await trade('alice', 40);
    await trade('alice', 60);
    expect(await activeForecasters7d(NOW)).toBe(1);
  });

  test('a redemption row is bookkeeping, not a trade', async () => {
    await trade('alice', 100, { kind: 'redeem' });
    expect(await activeForecasters7d(NOW)).toBe(0);
  });
});

describe('THE RULE: bots roll up to the verified person who funds them', () => {
  beforeEach(async () => {
    await paid('alice', 'manifold_link');
  });

  test('a bot registered from the browser account counts for its owner', async () => {
    await trade('alice-bot', 100);
    expect(await activeForecasters7d(NOW)).toBe(1);
  });

  test('a bot spawned by the agent key counts for its owner, and its own sub-bot does too', async () => {
    await trade('alice-spawn', 60);
    await trade('alice-grandchild', 40);
    expect(await activeForecasters7d(NOW)).toBe(1);
  });

  test('the person and their bots are ONE head however the trades are split', async () => {
    await trade('alice', 100);
    await trade('alice-bot', 100);
    await trade('alice-spawn', 100);
    await trade('alice-grandchild', 100);
    expect(await activeForecasters7d(NOW)).toBe(1);
  });

  test('the split adds up: 40 by the person and 60 by a bot is 100', async () => {
    await trade('alice', 40);
    await trade('alice-bot', 60);
    expect(await activeForecasters7d(NOW)).toBe(1);
  });

  test('a bot funded by an unverified participant is supply nobody vouched for', async () => {
    await trade('nobody-bot', 500);
    expect(await activeForecasters7d(NOW)).toBe(0);
  });

  test('a bot with no owner never counts', async () => {
    await trade('orphan-bot', 500);
    expect(await activeForecasters7d(NOW)).toBe(0);
  });

  test('a bot netting against its owner cancels: the owner buys 100, the bot sells 100', async () => {
    await trade('alice', 100);
    await trade('alice-bot', -100);
    expect(await activeForecasters7d(NOW)).toBe(0);
  });
});

describe('THE RULE: the house never counts', () => {
  test('a verified platform admin and the bot it operates are not forecasters', async () => {
    await paid('house', 'manifold_link');
    await trade('house', 1_000);
    await trade('house-bot', 1_000);
    expect(await activeForecasters7d(NOW)).toBe(0);
  });
});

describe('the window is the trailing seven days', () => {
  beforeEach(async () => {
    await paid('alice', 'manifold_link');
  });

  test('a trade six days ago counts, a trade eight days ago does not', async () => {
    await trade('alice', 100, { ago: 8 });
    expect(await activeForecasters7d(NOW)).toBe(0);
    await trade('alice', 100, { ago: 6 });
    expect(await activeForecasters7d(NOW)).toBe(1);
  });

  test('a sell inside the window against a buy outside it is negative exposure, not activity', async () => {
    await trade('alice', 500, { ago: 10 });
    await trade('alice', -100, { ago: 2 });
    expect(await activeForecasters7d(NOW)).toBe(0);
  });

  test('an empty platform reads zero', async () => {
    expect(await activeForecasters7d(NOW)).toBe(0);
  });
});
