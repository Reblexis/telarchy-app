/**
 * A BURST OF PER-BOOK READS COSTS A FIXED NUMBER OF STATEMENTS
 * (docs/infra/deploy.md, "Reads are bounded in the size of a workspace").
 *
 * Opening a proposal with options, the floor asks market-activity and history
 * once per option book, all at once: 218 of each for a chess position. On
 * 2026-09-13 the beta chess floor answered them in 3.0 s and 2.1 s on average
 * (telarchy umbrella, notes/gcp-cost-2026-09-13.md, item 4) while every single
 * query took under a millisecond: each call made eight round trips, and the
 * beta store has one connection, so the burst queued single file.
 *
 * The fix is a performance change, so the answers are pinned first: every
 * book's response, recorded from the code as it was before
 * (fixtures/option-book-burst.json), must come back byte for byte, one request
 * at a time and in a burst. Regenerate the fixture only for a deliberate
 * change of the response, with WRITE_OPTION_BOOK_GOLDEN=1.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

// The one-at-a-time golden read makes 82 requests in a row and the seed
// inserts ~1,100 rows; on a laptop shared with other suites that can pass 5 s.
jest.setTimeout(60_000);

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
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import {
  agents,
  authUser,
  liquidityEvents,
  markets,
  permissionGroups,
  positions,
  trades,
  workspaces,
} from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { marketplaceRouter } from '../routes/marketplace';
import { captureQueries, largest } from './harness/query-log';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: (err as Error).message });
});

const WS = 'ws-chess';
const SLUG = 'chess';
const OPTIONS = 40;
const BIG = 'opt-big';
const BIG_TRADES = 510;
const BIG_HOLDERS = 60;
/** Books of the same floor nobody asked about: the chess floor holds 7,842. */
const UNRELATED = 150;
const T0 = Date.parse('2026-09-13T12:00:00Z');
const at = (ms: number) => new Date(T0 + ms);
const SEC = 1000;
const HOUR = 3600 * SEC;

const optionIds = Array.from({ length: OPTIONS }, (_, i) => `opt-${String(i).padStart(3, '0')}`);
const allBooks = [...optionIds, BIG];

const GOLDEN = join(__dirname, 'fixtures', 'option-book-burst.json');

function book(id: string, workspaceId: string, shares: [number, number], liquidity: number, branch: string | null) {
  return {
    id,
    workspaceId,
    metricId: 'metric-win',
    metricName: 'Win',
    targetDate: '2026-09-20',
    rangeMin: 0,
    rangeMax: 100,
    shares,
    liquidity,
    pool: initialPool(liquidity),
    active: true,
    resolved: false,
    voided: false,
    proposalId: branch ? 'prop-41' : null,
    branch,
    createdAt: at(-HOUR),
  };
}

async function openFloor(id: string, visibility: 'public' | 'private', publicCaps: string[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, { wsId: id, name: id, createdBy: 'owner', ownerAgentId: 'owner', visibility });
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, id));
  for (const g of groups) {
    if (g.type === 'public')
      await db.update(permissionGroups).set({ capabilities: publicCaps }).where(eq(permissionGroups.id, g.id));
  }
}

async function seed() {
  await db.insert(authUser).values([{ id: 'u-hana', name: 'Hana', email: 'hana@example.com' }]);
  const holders = Array.from({ length: BIG_HOLDERS }, (_, i) => ({
    id: `holder-${String(i).padStart(2, '0')}`,
    // Half named, half not: an unnamed participant's handle is its id.
    nickname: i % 2 === 0 ? `holder${i}` : null,
    apiKeyHash: `h-holder-${i}`,
    balance: 0,
  }));
  await db
    .insert(agents)
    .values([
      { id: 'owner', apiKeyHash: 'h-owner', balance: 0 },
      { id: 'hana', nickname: 'hana', apiKeyHash: 'h-hana', balance: 0, authUserId: 'u-hana' },
      { id: 'robo', nickname: 'robo', apiKeyHash: 'h-robo', balance: 0 },
      { id: 'anon', apiKeyHash: 'h-anon', balance: 0 },
      ...holders,
    ]);
  await openFloor(WS, 'public', ['read', 'trade']);
  await db.update(workspaces).set({ slug: SLUG }).where(eq(workspaces.id, WS));
  await openFloor('ws-other', 'public', ['read', 'trade']);
  await openFloor('ws-private', 'private', ['read']);
  await openFloor('ws-closed', 'public', []);

  const bookRows = [];
  const liqRows = [];
  const tradeRows = [];
  const posRows = [];

  // Forty small option books, each with its own mix of rows.
  for (let i = 0; i < OPTIONS; i++) {
    const id = optionIds[i];
    const shares: [number, number] = [10, 10];
    let liquidity = 100;
    // The platform's opening row: zero contribution, dropped from the pool list.
    liqRows.push({
      id: `liq-${id}-init`,
      workspaceId: WS,
      marketId: id,
      amount: 0,
      poolContribution: null,
      totalLiquidity: 100,
      type: 'initial',
      agentId: null,
      createdAt: at(i * SEC),
    });
    if (i % 3 === 0) {
      liquidity = 150;
      liqRows.push({
        id: `liq-${id}-robo`,
        workspaceId: WS,
        marketId: id,
        amount: 50 + i,
        poolContribution: 50 + i,
        totalLiquidity: 150,
        type: 'injection',
        agentId: 'robo',
        createdAt: at(HOUR + i * SEC),
      });
    }
    if (i % 2 === 0) {
      tradeRows.push({
        id: `tr-${id}-hana`,
        workspaceId: WS,
        agentId: 'hana',
        marketId: id,
        direction: 'higher',
        shares: 5 + i,
        cost: 3 + i / 4,
        kind: 'trade',
        createdAt: at(2 * HOUR + i * SEC),
      });
      shares[1] += 5 + i;
      tradeRows.push({
        id: `tr-${id}-robo`,
        workspaceId: WS,
        agentId: 'robo',
        marketId: id,
        direction: 'lower',
        shares: -2,
        cost: -1.25,
        kind: 'trade',
        createdAt: at(3 * HOUR + i * SEC),
      });
      shares[0] -= 2;
      posRows.push(
        {
          id: `pos-${id}-hana`,
          workspaceId: WS,
          agentId: 'hana',
          marketId: id,
          direction: 'higher',
          shares: 5 + i,
          totalCost: 3 + i / 4,
        },
        {
          id: `pos-${id}-robo`,
          workspaceId: WS,
          agentId: 'robo',
          marketId: id,
          direction: 'lower',
          shares: 3,
          totalCost: 2,
        },
      );
    }
    if (i % 4 === 0) {
      // A closed-out position: zero shares, never listed.
      posRows.push({
        id: `pos-${id}-anon`,
        workspaceId: WS,
        agentId: 'anon',
        marketId: id,
        direction: 'higher',
        shares: 0,
        totalCost: 0,
      });
    }
    if (i % 5 === 0) {
      // A redemption: one row per side at the same instant, not trades.
      for (const direction of ['higher', 'lower']) {
        tradeRows.push({
          id: `tr-${id}-redeem-${direction}`,
          workspaceId: WS,
          agentId: 'anon',
          marketId: id,
          direction,
          shares: -1,
          cost: -0.5,
          kind: 'redeem',
          createdAt: at(4 * HOUR + i * SEC),
        });
        shares[direction === 'higher' ? 1 : 0] -= 1;
      }
    }
    bookRows.push(book(id, WS, shares, liquidity, `o${i}`));
  }

  // The big book: more of everything than any limit allows.
  const bigShares: [number, number] = [20, 20];
  liqRows.push({
    id: 'liq-big-init',
    workspaceId: WS,
    marketId: BIG,
    amount: 0,
    poolContribution: null,
    totalLiquidity: 200,
    type: 'initial',
    agentId: null,
    createdAt: at(0),
  });
  for (let k = 0; k < BIG_HOLDERS; k++) {
    liqRows.push({
      id: `liq-big-${k}`,
      workspaceId: WS,
      marketId: BIG,
      amount: 1 + k,
      poolContribution: 1 + k,
      totalLiquidity: 200 + k + 1,
      type: 'injection',
      agentId: holders[k].id,
      createdAt: at(HOUR + k * 60 * SEC),
    });
    posRows.push({
      id: `pos-big-${k}`,
      workspaceId: WS,
      agentId: holders[k].id,
      marketId: BIG,
      direction: k % 2 === 0 ? 'higher' : 'lower',
      shares: 1 + k * 1.5,
      totalCost: 1 + k,
    });
  }
  for (let k = 0; k < BIG_TRADES; k++) {
    const direction = k % 3 === 0 ? 'lower' : 'higher';
    const sharesDelta = k % 7 === 0 ? -0.5 : 1 + (k % 5) / 10;
    tradeRows.push({
      id: `tr-big-${String(k).padStart(3, '0')}`,
      workspaceId: WS,
      agentId: holders[k % BIG_HOLDERS].id,
      marketId: BIG,
      direction,
      shares: sharesDelta,
      cost: sharesDelta * 0.6,
      kind: 'trade',
      createdAt: at(5 * HOUR + k * SEC),
    });
    bigShares[direction === 'higher' ? 1 : 0] += sharesDelta;
  }
  bookRows.push(book(BIG, WS, bigShares, 200 + BIG_HOLDERS, 'o-big'));

  // The rest of the floor, and books elsewhere, that no request names.
  for (let u = 0; u < UNRELATED; u++) {
    const id = `unrelated-${u}`;
    bookRows.push(book(id, WS, [10, 10], 100, null));
    liqRows.push({
      id: `liq-${id}`,
      workspaceId: WS,
      marketId: id,
      amount: 5,
      poolContribution: 5,
      totalLiquidity: 100,
      type: 'injection',
      agentId: 'robo',
      createdAt: at(u * SEC),
    });
    posRows.push({
      id: `pos-${id}`,
      workspaceId: WS,
      agentId: 'robo',
      marketId: id,
      direction: 'higher',
      shares: 2,
      totalCost: 1,
    });
    tradeRows.push({
      id: `tr-${id}`,
      workspaceId: WS,
      agentId: 'robo',
      marketId: id,
      direction: 'higher',
      shares: 1,
      cost: 0.5,
      kind: 'trade',
      createdAt: at(u * SEC),
    });
  }
  bookRows.push(book('other-book', 'ws-other', [10, 10], 100, null));
  bookRows.push(book('private-book', 'ws-private', [10, 10], 100, null));
  bookRows.push(book('closed-book', 'ws-closed', [10, 10], 100, null));

  await db.insert(markets).values(bookRows);
  for (let s = 0; s < liqRows.length; s += 200) await db.insert(liquidityEvents).values(liqRows.slice(s, s + 200));
  for (let s = 0; s < tradeRows.length; s += 200) await db.insert(trades).values(tradeRows.slice(s, s + 200));
  for (let s = 0; s < posRows.length; s += 200) await db.insert(positions).values(posRows.slice(s, s + 200));
}

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await seed();
});

const activityPath = (ws: string, marketId?: string) =>
  `/api/marketplace/${ws}/market-activity` + (marketId === undefined ? '' : `?marketId=${marketId}`);
const historyPath = (ws: string, marketId: string) => `/api/marketplace/${ws}/markets/${marketId}/history`;

/** One read, as its status and the JSON text exactly as served. */
async function read(path: string): Promise<{ status: number; body: unknown }> {
  const res = await request(app).get(path);
  return { status: res.status, body: res.body };
}

type Golden = { activity: Record<string, unknown>; history: Record<string, unknown> };

function golden(): Golden {
  return JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden;
}

describe('the answers do not change', () => {
  test('every option book answers market-activity and history exactly as recorded, one request at a time', async () => {
    const recorded: Golden = { activity: {}, history: {} };
    for (const id of allBooks) {
      const a = await read(activityPath(SLUG, id));
      expect(a.status).toBe(200);
      recorded.activity[id] = a.body;
      const h = await read(historyPath(SLUG, id));
      expect(h.status).toBe(200);
      recorded.history[id] = h.body;
    }
    if (process.env.WRITE_OPTION_BOOK_GOLDEN === '1' || !existsSync(GOLDEN)) {
      if (process.env.WRITE_OPTION_BOOK_GOLDEN !== '1') throw new Error(`missing ${GOLDEN}`);
      writeFileSync(GOLDEN, `${JSON.stringify(recorded, null, 1)}\n`);
    }
    expect(recorded).toEqual(golden());
  });

  test('a burst of market-activity reads for every option answers each book exactly as one request would', async () => {
    const g = golden();
    const answers = await Promise.all(allBooks.map(id => read(activityPath(SLUG, id))));
    answers.forEach((a, i) => {
      expect(a.status).toBe(200);
      expect(a.body).toEqual(g.activity[allBooks[i]]);
    });
  });

  test('a burst of history reads for every option answers each book exactly as one request would', async () => {
    const g = golden();
    const answers = await Promise.all(allBooks.map(id => read(historyPath(SLUG, id))));
    answers.forEach((a, i) => {
      expect(a.status).toBe(200);
      expect(a.body).toEqual(g.history[allBooks[i]]);
    });
  });

  test('limits stay per book inside a burst: the big book is cut to 50 and 500, its neighbours keep every row', async () => {
    const [bigActivity, smallActivity, bigHistory, smallHistory] = await Promise.all([
      read(activityPath(SLUG, BIG)),
      read(activityPath(SLUG, optionIds[0])),
      read(historyPath(SLUG, BIG)),
      read(historyPath(SLUG, optionIds[0])),
    ]);
    const big = bigActivity.body as { positions: Array<{ shares: number }>; trades: unknown[]; pool: unknown[] };
    expect(big.positions).toHaveLength(50);
    expect(big.trades).toHaveLength(50);
    expect(big.pool).toHaveLength(50);
    // Top 50 by size: the smallest listed outweighs every holder left out.
    expect(Math.min(...big.positions.map(p => p.shares))).toBe(1 + 10 * 1.5);
    const small = smallActivity.body as { positions: unknown[]; trades: unknown[]; pool: unknown[] };
    expect(small.positions).toHaveLength(2);
    expect(small.trades).toHaveLength(2);
    expect(small.pool).toHaveLength(1);
    expect((bigHistory.body as { history: unknown[] }).history).toHaveLength(500);
    // Opening point plus two trades plus the redemption pair.
    expect((smallHistory.body as { history: unknown[] }).history).toHaveLength(5);
  });

  test('the slug and the id in one burst read the same floor', async () => {
    const [bySlug, byId, histSlug, histId] = await Promise.all([
      read(activityPath(SLUG, optionIds[2])),
      read(activityPath(WS, optionIds[2])),
      read(historyPath(SLUG, optionIds[2])),
      read(historyPath(WS, optionIds[2])),
    ]);
    expect(byId).toEqual(bySlug);
    expect(histId).toEqual(histSlug);
    expect(bySlug.body).toEqual(golden().activity[optionIds[2]]);
  });
});

describe('a bad request inside a burst gets its own answer and sinks nobody', () => {
  test('market-activity', async () => {
    const g = golden();
    const cases: Array<[string, number]> = [
      [activityPath(SLUG, optionIds[0]), 200],
      [activityPath(SLUG, 'other-book'), 404],
      [activityPath(SLUG), 400],
      [activityPath('no-such-floor', optionIds[0]), 404],
      [activityPath('ws-private', 'private-book'), 403],
      [activityPath('ws-closed', 'closed-book'), 403],
      [activityPath(SLUG, 'no-such-book'), 404],
      [activityPath(SLUG, optionIds[1]), 200],
    ];
    const answers = await Promise.all(cases.map(([p]) => read(p)));
    expect(answers.map(a => a.status)).toEqual(cases.map(([, s]) => s));
    expect(answers[0].body).toEqual(g.activity[optionIds[0]]);
    expect(answers[7].body).toEqual(g.activity[optionIds[1]]);
    expect(answers.map(a => (a.body as { error?: string }).error ?? null)).toEqual([
      null,
      'Market not found',
      'Pass marketId',
      'Workspace not found',
      'This workspace is private',
      'Not public',
      'Market not found',
      null,
    ]);
  });

  test('history', async () => {
    const g = golden();
    const cases: Array<[string, number]> = [
      [historyPath(SLUG, optionIds[0]), 200],
      [historyPath(SLUG, 'other-book'), 404],
      [historyPath('no-such-floor', optionIds[0]), 404],
      [historyPath('ws-private', 'private-book'), 403],
      [historyPath('ws-closed', 'closed-book'), 403],
      [historyPath(SLUG, optionIds[1]), 200],
    ];
    const answers = await Promise.all(cases.map(([p]) => read(p)));
    expect(answers.map(a => a.status)).toEqual(cases.map(([, s]) => s));
    expect(answers[0].body).toEqual(g.history[optionIds[0]]);
    expect(answers[5].body).toEqual(g.history[optionIds[1]]);
  });
});

test('a trade written after a burst is in the very next read', async () => {
  await Promise.all(allBooks.map(id => read(activityPath(SLUG, id))));
  await db.insert(trades).values({
    id: 'tr-fresh',
    workspaceId: WS,
    agentId: 'hana',
    marketId: optionIds[1],
    direction: 'higher',
    shares: 4,
    cost: 2,
    kind: 'trade',
    createdAt: at(10 * HOUR),
  });
  const after = await read(activityPath(SLUG, optionIds[1]));
  expect((after.body as { trades: Array<{ id: string }> }).trades.map(t => t.id)).toEqual(['tr-fresh']);
});

describe('THE RULE: a burst for every option of a proposal costs a fixed number of statements, not a number per option', () => {
  // A burst is at most a few coalesced flights, each a fixed handful of
  // statements (the workspace, its Public group, then one per table). Before
  // the fix each book cost eight or nine on its own: ~370 for this burst.
  const MAX_STATEMENTS = 30;
  // The largest single answer a burst may need: the rows of the books asked
  // for (41 books; per list at most 50 on the big book plus about 90 across
  // the small ones), never the floor's 150 other books, which a read that
  // forgot its market filter would add to whichever list it forgot.
  const MAX_ROWS = 150;

  test('market-activity', async () => {
    const log = captureQueries();
    const answers = await Promise.all(allBooks.map(id => read(activityPath(SLUG, id))));
    const stats = log.stop();
    expect(answers.every(a => a.status === 200)).toBe(true);
    expect({ statements: stats.length, largest: largest(stats)?.rows }).toEqual({
      statements: Math.min(stats.length, MAX_STATEMENTS),
      largest: Math.min(largest(stats)?.rows ?? 0, MAX_ROWS),
    });
  });

  test('history', async () => {
    const log = captureQueries();
    const answers = await Promise.all(allBooks.map(id => read(historyPath(SLUG, id))));
    const stats = log.stop();
    expect(answers.every(a => a.status === 200)).toBe(true);
    // History reads every trade of a book (the replay needs them all), so the
    // row bound is the books' own rows: 510 + 60 + the small books'.
    expect({ statements: stats.length }).toEqual({ statements: Math.min(stats.length, MAX_STATEMENTS) });
    expect(largest(stats)?.rows ?? 0).toBeLessThan(BIG_TRADES + 3 * OPTIONS + 50);
  });
});
