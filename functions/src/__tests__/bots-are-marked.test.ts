/**
 * A bot says it is one (docs/ui-conventions.md, "A bot says it is one").
 *
 * A participant with no browser account is a bot, and every public read
 * that serves a participant's name says so beside it, so no page has to
 * guess: the board row, the contractor, each position, trade and pool row
 * of market activity, the comment, the proposal, the profile. A browser
 * account is never a bot, even a house one. A bot the platform runs names
 * its model on the profile. The floor counts the bots that traded on it in
 * the last seven days, which is the line that invites a trader to build one.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    optionalAuthMiddleware: async (_req: any, _res: any, next: any) => next(),
    getAuthWorkspaceMemberships: async () => [],
  };
});

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import {
  agents,
  authUser,
  liquidityEvents,
  marketForecasts,
  marketMessages,
  markets,
  metrics,
  permissionGroups,
  positions,
  proposals,
  trades,
} from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { HELP } from '../lib/help-catalog';
import { botIds, provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { agentsRouter } from '../routes/agents';
import { clearBoardCache, leaderboardRouter } from '../routes/leaderboard';
import { marketplaceRouter } from '../routes/marketplace';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/agents', agentsRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/marketplace', marketplaceRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: (err as Error).message });
});

const WS = 'ws-bots';
const OTHER_WS = 'ws-elsewhere';
const MKT = 'mkt-bots';
const OTHER_MKT = 'mkt-elsewhere';

// hana: a person (browser account).
// robo: a bot somebody runs (API-registered, not the platform's).
// astra: a bot the platform runs, with recorded forecasts.
// quiet: a bot the platform runs that never filed a forecast.
// house: a house account a person signs in to (browser + platformOperated).
// stale: a bot whose only trade is eight days old.
// redeemer: a bot whose only ledger row this week is a redemption.
// roamer: a bot that traded this week, but on another floor.
const DAY = 24 * 3600 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  clearBoardCache();
  await seed();
});

async function openFloor(id: string, members: string[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: id,
    name: id,
    createdBy: 'owner',
    ownerAgentId: 'owner',
    visibility: 'public',
  });
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, id));
  for (const g of groups) {
    if (g.type === 'trader')
      await db.update(permissionGroups).set({ memberIds: members }).where(eq(permissionGroups.id, g.id));
    if (g.type === 'public')
      await db
        .update(permissionGroups)
        .set({ capabilities: ['read', 'trade'] })
        .where(eq(permissionGroups.id, g.id));
  }
}

async function seed() {
  await db.insert(authUser).values([
    { id: 'u-hana', name: 'Hana', email: 'hana@example.com' },
    { id: 'u-house', name: 'House', email: 'house@example.com' },
  ]);
  await db.insert(agents).values([
    { id: 'owner', apiKeyHash: 'h-owner', balance: 0, authUserId: null },
    { id: 'hana', nickname: 'hana', apiKeyHash: 'h-hana', balance: toUnits(100), authUserId: 'u-hana' },
    { id: 'robo', nickname: 'robo', apiKeyHash: 'h-robo', balance: toUnits(100), ownerUserId: 'u-hana' },
    { id: 'astra', nickname: 'astra', apiKeyHash: 'h-astra', balance: toUnits(100), platformOperated: true },
    { id: 'quiet', nickname: 'quiet', apiKeyHash: 'h-quiet', balance: toUnits(100), platformOperated: true },
    {
      id: 'house',
      nickname: 'house',
      apiKeyHash: 'h-house',
      balance: toUnits(100),
      authUserId: 'u-house',
      platformOperated: true,
    },
    { id: 'stale', nickname: 'stale', apiKeyHash: 'h-stale', balance: toUnits(100) },
    { id: 'redeemer', nickname: 'redeemer', apiKeyHash: 'h-redeemer', balance: toUnits(100) },
    { id: 'roamer', nickname: 'roamer', apiKeyHash: 'h-roamer', balance: toUnits(100) },
  ]);
  const everyone = ['hana', 'robo', 'astra', 'quiet', 'house', 'stale', 'redeemer', 'roamer'];
  await openFloor(WS, everyone);
  await openFloor(OTHER_WS, everyone);

  for (const [ws, id] of [
    [WS, MKT],
    [OTHER_WS, OTHER_MKT],
  ]) {
    await db
      .insert(metrics)
      .values({ id: `metric-${ws}`, workspaceId: ws, name: 'Users', value: 0, formula: '0', marketRangeMax: 100 });
    await db.insert(markets).values({
      id,
      workspaceId: ws,
      metricId: `metric-${ws}`,
      metricName: 'Users',
      targetDate: '2026-12',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 4],
      liquidity: 10,
      pool: initialPool(10),
      active: true,
      resolved: false,
      voided: false,
    });
  }

  const trade = (id: string, agentId: string, when: Date, over: Record<string, unknown> = {}) => ({
    id,
    agentId,
    workspaceId: WS,
    marketId: MKT,
    direction: 'higher',
    shares: 5,
    cost: 2,
    createdAt: when,
    ...over,
  });
  await db
    .insert(trades)
    .values([
      trade('t-hana', 'hana', ago(0)),
      trade('t-robo', 'robo', ago(1)),
      trade('t-robo-2', 'robo', ago(2)),
      trade('t-astra', 'astra', ago(3)),
      trade('t-house', 'house', ago(0)),
      trade('t-stale', 'stale', ago(8)),
      trade('t-redeem', 'redeemer', ago(1), { kind: 'redeem', shares: -1, cost: -0.5 }),
      trade('t-roam', 'roamer', ago(1), { workspaceId: OTHER_WS, marketId: OTHER_MKT }),
    ] as never);
  await db.insert(positions).values([
    { id: 'p-hana', agentId: 'hana', workspaceId: WS, marketId: MKT, direction: 'higher', shares: 5, totalCost: 2 },
    { id: 'p-robo', agentId: 'robo', workspaceId: WS, marketId: MKT, direction: 'lower', shares: 10, totalCost: 2 },
  ]);
  await db.insert(liquidityEvents).values([
    { id: 'l-house', workspaceId: WS, marketId: MKT, agentId: null, amount: 10, totalLiquidity: 10, type: 'initial' },
    { id: 'l-robo', workspaceId: WS, marketId: MKT, agentId: 'robo', amount: 5, totalLiquidity: 15, type: 'add' },
    { id: 'l-hana', workspaceId: WS, marketId: MKT, agentId: 'hana', amount: 5, totalLiquidity: 20, type: 'add' },
  ] as never);
  await db.insert(marketMessages).values([
    { id: 'c-hana', workspaceId: WS, marketId: MKT, from: 'hana', content: 'I think higher' },
    { id: 'c-robo', workspaceId: WS, marketId: MKT, from: 'robo', content: 'estimate 42' },
  ]);
  await db.insert(proposals).values([
    { id: 'prop-robo', workspaceId: WS, proposedBy: 'robo', title: 'A bot proposes', status: 'pending', number: 1 },
    { id: 'prop-hana', workspaceId: WS, proposedBy: 'hana', title: 'A person proposes', status: 'pending', number: 2 },
  ] as never);
  await db.insert(marketForecasts).values([
    { id: 'f-old', workspaceId: WS, marketId: MKT, agentId: 'astra', value: 40, model: 'model-old', createdAt: ago(2) },
    {
      id: 'f-new',
      workspaceId: WS,
      marketId: MKT,
      agentId: 'astra',
      value: 41,
      model: 'gpt-6-astra/xhigh',
      createdAt: ago(1),
    },
    // A forecast with no model label is not a model: the newest labelled one is.
    { id: 'f-nolabel', workspaceId: WS, marketId: MKT, agentId: 'astra', value: 42, model: null, createdAt: ago(0) },
  ]);
}

describe('who is a bot', () => {
  test('A PARTICIPANT WITH NO BROWSER ACCOUNT IS A BOT, a browser account never is', async () => {
    const set = await botIds(['hana', 'robo', 'astra', 'house', 'nobody']);
    expect([...set].sort()).toEqual(['astra', 'robo']);
  });

  test('A HOUSE ACCOUNT A PERSON SIGNS IN TO IS NOT A BOT, platformOperated or not', async () => {
    expect((await botIds(['house'])).has('house')).toBe(false);
  });

  test('no ids, no query and an empty set', async () => {
    expect((await botIds([])).size).toBe(0);
  });
});

describe('every public read says bot beside the name', () => {
  test('leaderboard rows carry bot', async () => {
    const res = await request(app).get('/api/leaderboard');
    expect(res.status).toBe(200);
    const by = new Map<string, any>(res.body.participants.map((p: any) => [p.id, p]));
    expect(by.get('robo')?.bot).toBe(true);
    expect(by.get('astra')?.bot).toBe(true);
    expect(by.get('hana')?.bot).toBe(false);
    expect(by.get('house')?.bot).toBe(false);
  });

  test('market activity: positions, trades and pool rows carry bot; the house pool is not a bot', async () => {
    const res = await request(app).get(`/api/marketplace/${WS}/market-activity`).query({ marketId: MKT });
    expect(res.status).toBe(200);
    const pos = new Map<string, any>(res.body.positions.map((p: any) => [p.id, p]));
    expect(pos.get('robo').bot).toBe(true);
    expect(pos.get('hana').bot).toBe(false);
    const tr = new Map<string, any>(res.body.trades.map((t: any) => [t.id, t]));
    expect(tr.get('t-robo').bot).toBe(true);
    expect(tr.get('t-astra').bot).toBe(true);
    expect(tr.get('t-hana').bot).toBe(false);
    expect(tr.get('t-house').bot).toBe(false);
    const pool = new Map<string, any>(res.body.pool.map((p: any) => [p.id, p]));
    expect(pool.get('l-robo').bot).toBe(true);
    expect(pool.get('l-hana').bot).toBe(false);
    expect(pool.get('l-house').bot).toBe(false);
  });

  test('comments carry fromBot', async () => {
    const res = await request(app).get(`/api/marketplace/${WS}/comments`).query({ marketId: MKT });
    expect(res.status).toBe(200);
    const by = new Map<string, any>(res.body.map((c: any) => [c.id, c]));
    expect(by.get('c-robo').fromBot).toBe(true);
    expect(by.get('c-hana').fromBot).toBe(false);
  });

  test('proposals carry proposedByBot, and contractors carry bot', async () => {
    const res = await request(app).get(`/api/marketplace/${WS}`);
    expect(res.status).toBe(200);
    const props = new Map<string, any>(res.body.proposals.map((p: any) => [p.id, p]));
    expect(props.get('prop-robo').proposedByBot).toBe(true);
    expect(props.get('prop-hana').proposedByBot).toBe(false);
    const contractors = new Map<string, any>((res.body.topContractors ?? []).map((c: any) => [c.id, c]));
    expect(contractors.get('robo')?.bot).toBe(true);
    expect(contractors.get('hana')?.bot).toBe(false);
  });
});

describe('the floor counts the bots that trade on it', () => {
  test('BOT TRADERS ARE DISTINCT BOTS WITH A TRADE HERE IN THE LAST SEVEN DAYS', async () => {
    // robo (twice) and astra; not hana or house (people), not stale (eight
    // days), not redeemer (a redemption is not a trade), not roamer (other floor).
    const res = await request(app).get(`/api/marketplace/${WS}`);
    expect(res.body.botTraders).toBe(2);
  });

  test('a floor only people traded on says zero', async () => {
    // Trades are append-only, so a floor of its own rather than a deletion.
    await openFloor('ws-people', ['hana']);
    await db
      .insert(metrics)
      .values({
        id: 'metric-people',
        workspaceId: 'ws-people',
        name: 'Users',
        value: 0,
        formula: '0',
        marketRangeMax: 100,
      });
    await db.insert(markets).values({
      id: 'mkt-people',
      workspaceId: 'ws-people',
      metricId: 'metric-people',
      metricName: 'Users',
      targetDate: '2026-12',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 4],
      liquidity: 10,
      pool: initialPool(10),
      active: true,
      resolved: false,
      voided: false,
    });
    await db.insert(trades).values({
      id: 't-people',
      agentId: 'hana',
      workspaceId: 'ws-people',
      marketId: 'mkt-people',
      direction: 'higher',
      shares: 5,
      cost: 2,
    } as never);
    const res = await request(app).get('/api/marketplace/ws-people');
    expect(res.body.botTraders).toBe(0);
  });
});

describe('the profile of a bot', () => {
  test('A BOT THE PLATFORM RUNS NAMES ITS MODEL: the newest labelled forecast', async () => {
    const res = await request(app).get('/api/agents/astra/public');
    expect(res.status).toBe(200);
    expect(res.body.bot).toBe(true);
    expect(res.body.runBy).toBe('telarchy');
    expect(res.body.model).toBe('gpt-6-astra/xhigh');
  });

  test('a platform bot that never filed a forecast is run by Telarchy with no model', async () => {
    const res = await request(app).get('/api/agents/quiet/public');
    expect(res.body).toMatchObject({ bot: true, runBy: 'telarchy', model: null });
  });

  test('a bot somebody else runs is a bot with no run line', async () => {
    const res = await request(app).get('/api/agents/robo/public');
    expect(res.body).toMatchObject({ bot: true, runBy: null, model: null });
  });

  test('a person is not a bot; a house account a person signs in to is not either', async () => {
    const hana = await request(app).get('/api/agents/hana/public');
    expect(hana.body).toMatchObject({ bot: false, runBy: null, model: null });
    const house = await request(app).get('/api/agents/house/public');
    expect(house.body).toMatchObject({ bot: false, runBy: null, model: null });
  });
});

describe('/api/help names the new fields where it describes the reads', () => {
  const flat = (() => {
    const groups = (HELP as { endpoints?: unknown }).endpoints;
    return (
      Array.isArray(groups)
        ? groups
        : Object.values((groups ?? {}) as Record<string, unknown>).flatMap(g => (Array.isArray(g) ? g : []))
    ) as Array<{ path?: string; description?: string }>;
  })();
  const d = (path: string) => flat.find(e => e.path === path)?.description ?? '';

  test.each([
    ['/api/leaderboard', ['bot']],
    ['/api/marketplace/:idOrSlug/market-activity', ['bot']],
    ['/api/marketplace/:idOrSlug/comments', ['fromBot']],
    ['/api/marketplace/:workspaceId', ['proposedByBot', 'botTraders']],
    ['/api/agents/:idOrNickname/public', ['bot', 'runBy', 'model']],
  ])('%s names %j', (path, fields) => {
    for (const f of fields) expect(d(path)).toMatch(new RegExp(`\\b${f}\\b`));
  });
});
