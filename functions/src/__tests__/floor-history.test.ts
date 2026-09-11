/**
 * GET /api/marketplace/:idOrSlug/history: a floor's history as the tree of
 * worlds it is (docs/ui-conventions.md, "A floor's history"; the /api/help
 * catalog entry is the contract).
 *
 * Every decision is a fork: the world the owner picked continues as the
 * trunk, every other world is priced at what the market gave it when the
 * owner ruled. Every settled baseline book sits on the trunk with the call
 * the market had and the value it settled on. The rules pinned here are the
 * ones a picture of history would otherwise quietly get wrong: which world
 * was taken, which numbers are shown, what counts as one fork, and that a
 * page never cuts a fork in half.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  getAuthWorkspaceMemberships: async () => [],
}));

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import type { DecidedPair } from '../db/schema';
import { agents, markets, metrics, permissionGroups, proposals, workspaces } from '../db/schema';
import { consensus, initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
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

const WS = 'ws-history';
const TRADERS = 'metric-traders';
const REVENUE = 'metric-revenue';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await seed();
});

async function seed(opts: { publicCaps?: string[]; visibility?: string } = {}) {
  const { publicCaps = ['read', 'trade'], visibility = 'public' } = opts;
  await db.insert(agents).values([
    { id: 'owner', apiKeyHash: 'h-owner', balance: 0, nickname: 'Viktor36' },
    { id: 'jason', apiKeyHash: 'h-jason', balance: 0, nickname: 'jason' },
    { id: 'snake', apiKeyHash: 'h-snake', balance: 0, nickname: 'snake' },
  ]);
  await db.insert(workspaces).values({ id: WS, name: 'Telarchy', createdBy: 'owner', visibility, slug: 'telarchy' });
  await db.insert(permissionGroups).values({
    id: 'grp-pub',
    workspaceId: WS,
    name: 'Public',
    type: 'public',
    capabilities: publicCaps,
    memberIds: [],
    sourcePermissions: {},
  });
  await db.insert(metrics).values([
    { id: TRADERS, workspaceId: WS, name: 'Active traders', description: 'Traders.', value: 7, marketRangeMax: 50 },
    { id: REVENUE, workspaceId: WS, name: 'Revenue (USD)', description: 'Revenue.', value: 40, marketRangeMax: 500 },
  ]);
}

let numberSeq = 1;
async function decided(p: {
  id: string;
  status: string;
  at: string;
  title?: string;
  by?: string;
  pricing?: DecidedPair[] | null;
  createdAt?: string;
  decideBy?: string;
  lapsedAt?: string;
  declineReason?: string;
  askUsd?: number;
}) {
  await db.insert(proposals).values({
    id: p.id,
    workspaceId: WS,
    proposedBy: p.by ?? 'jason',
    title: p.title ?? `Proposal ${p.id}`,
    status: p.status,
    number: numberSeq++,
    askUsd: p.askUsd ?? null,
    // A real proposal's deadline is its posting plus the floor's window, so
    // two proposals only share one when they were posted together.
    createdAt: new Date(p.createdAt ?? Date.parse(p.at) - 3_600_000),
    decideBy: new Date(p.decideBy ?? Date.parse(p.createdAt ?? p.at) + 86_400_000),
    resolvedAt: p.status === 'pending' ? null : new Date(p.at),
    closedAt: p.status === 'pending' ? null : new Date(p.at),
    lapsedAt: p.lapsedAt ? new Date(p.lapsedAt) : null,
    declineReason: p.declineReason ?? null,
    decidedPricing: p.pricing === undefined ? null : p.pricing,
  });
}

const pair = (metricId: string, targetDate: string, a: number | null, d: number | null): DecidedPair => ({
  metricId,
  targetDate,
  approvedConsensus: a,
  declinedConsensus: d,
});

async function book(b: {
  id: string;
  metricId?: string;
  metricName?: string;
  targetDate: string;
  at?: string | null;
  value?: number | null;
  voided?: boolean;
  shares?: [number, number];
  proposalId?: string | null;
  branch?: 'approved' | 'declined' | null;
}) {
  const settled = b.at !== undefined && b.at !== null;
  await db.insert(markets).values({
    id: b.id,
    workspaceId: WS,
    metricId: b.metricId ?? TRADERS,
    metricName: b.metricName ?? 'Active traders',
    targetDate: b.targetDate,
    rangeMin: 0,
    rangeMax: 50,
    shares: b.shares ?? [0, 0],
    liquidity: 100,
    pool: initialPool(100),
    active: !settled,
    resolved: settled,
    resolvedAt: settled ? new Date(b.at as string) : null,
    actualValue: b.voided ? null : (b.value ?? null),
    voided: b.voided ?? false,
    proposalId: b.proposalId ?? null,
    branch: b.branch ?? null,
  });
}

const get = (q = '', slug = 'telarchy') => request(app).get(`/api/marketplace/${slug}/history${q}`);
const forks = (body: any) => body.events.filter((e: any) => e.kind === 'fork');
const settles = (body: any) => body.events.filter((e: any) => e.kind === 'settle');

describe('A DECISION IS A FORK: the world taken is the one the owner picked', () => {
  test('an approved proposal takes the approved world and leaves the declined one priced', async () => {
    await decided({
      id: 'p1',
      status: 'approved',
      at: '2026-09-05T10:00:00Z',
      title: 'Referral rule',
      askUsd: 50,
      pricing: [pair(TRADERS, '2026-09', 18, 14)],
    });
    const res = await get();
    expect(res.status).toBe(200);
    const [f] = forks(res.body);
    expect(f.verdict).toBe('approved');
    expect(f.title).toBe('Referral rule');
    expect(f.at).toBe('2026-09-05T10:00:00.000Z');
    expect(f.metric).toEqual({ id: TRADERS, name: 'Active traders', targetDate: '2026-09' });
    expect(f.options).toEqual([
      { label: 'if approved', proposalId: 'p1', taken: true, price: 18 },
      { label: 'if declined', proposalId: 'p1', taken: false, price: 14 },
    ]);
    expect(f.proposals[0]).toMatchObject({
      id: 'p1',
      title: 'Referral rule',
      askUsd: 50,
      proposedBy: 'jason',
      status: 'approved',
      href: `/telarchy/p/${f.proposals[0].number}`,
    });
  });

  test('a declined proposal takes the declined world and carries the published reason', async () => {
    await decided({
      id: 'p1',
      status: 'declined',
      at: '2026-09-05T10:00:00Z',
      declineReason: 'There is already a prize',
      pricing: [pair(TRADERS, '2026-09', 20, 18.6)],
    });
    const [f] = forks((await get()).body);
    expect(f.verdict).toBe('declined');
    expect(f.options.find((o: any) => o.taken).label).toBe('if declined');
    expect(f.proposals[0].declineReason).toBe('There is already a prize');
  });

  test('a lapsed proposal reads lapsed, and the world taken is the declined one because nothing was done', async () => {
    await decided({
      id: 'p1',
      status: 'declined',
      at: '2026-09-05T10:00:00Z',
      lapsedAt: '2026-09-05T10:00:00Z',
      pricing: [pair(TRADERS, '2026-09', 20, 18)],
    });
    const [f] = forks((await get()).body);
    expect(f.verdict).toBe('lapsed');
    expect(f.options.find((o: any) => o.taken).label).toBe('if declined');
  });

  test('A PROPOSAL THAT LAPSED IS HISTORY: the status the deadline sweep writes is a fork like any ruling', async () => {
    // lapseOverdueProposals writes status 'lapsed' (services/proposals.ts);
    // a history that only knew the ruled statuses dropped every lapse.
    await decided({
      id: 'p1',
      status: 'lapsed',
      at: '2026-09-05T10:00:00Z',
      lapsedAt: '2026-09-05T10:00:00Z',
      pricing: [pair(TRADERS, '2026-09', 20, 18)],
    });
    const res = await get();
    const [f] = forks(res.body);
    expect(f.verdict).toBe('lapsed');
    expect(f.options.find((o: any) => o.taken).label).toBe('if declined');
    expect(res.body.counts.decided).toBe(1);
  });

  test('a withdrawn proposal reads withdrawn and takes the declined world', async () => {
    await decided({ id: 'p1', status: 'withdrawn', at: '2026-09-05T10:00:00Z' });
    const [f] = forks((await get()).body);
    expect(f.verdict).toBe('withdrawn');
    expect(f.options.find((o: any) => o.taken).label).toBe('if declined');
  });

  test('a proposal declined as spam reads declined', async () => {
    await decided({ id: 'p1', status: 'declined_spam', at: '2026-09-05T10:00:00Z' });
    expect(forks((await get()).body)[0].verdict).toBe('declined');
  });

  test('a removed proposal is not history: it is on no page and in no count', async () => {
    await decided({ id: 'p1', status: 'removed', at: '2026-09-05T10:00:00Z' });
    const res = await get();
    expect(res.body.events).toEqual([]);
    expect(res.body.open).toEqual([]);
    expect(res.body.counts.decided).toBe(0);
  });
});

describe('THE NUMBERS ARE THE PAIR RECORDED AT THE DECISION, never the books afterwards', () => {
  test('the recorded pair wins over what the branch books say now', async () => {
    await decided({
      id: 'p1',
      status: 'approved',
      at: '2026-09-05T10:00:00Z',
      pricing: [pair(TRADERS, '2026-09', 18, 14)],
    });
    // The winning book kept trading after the decision; the history must not follow it.
    await book({ id: 'b-a', targetDate: '2026-09', proposalId: 'p1', branch: 'approved', shares: [0, 80] });
    await book({
      id: 'b-d',
      targetDate: '2026-09',
      proposalId: 'p1',
      branch: 'declined',
      voided: true,
      at: '2026-09-05T10:00:00Z',
    });
    const [f] = forks((await get()).body);
    expect(f.options.map((o: any) => o.price)).toEqual([18, 14]);
  });

  test('of several recorded pairs the fork shows the one with the largest impact', async () => {
    await decided({
      id: 'p1',
      status: 'approved',
      at: '2026-09-05T10:00:00Z',
      pricing: [pair(TRADERS, '2026-09', 18, 17), pair(REVENUE, '2026-09', 113, 92.8), pair(TRADERS, '2026-W37', 9, 9)],
    });
    const [f] = forks((await get()).body);
    expect(f.metric).toEqual({ id: REVENUE, name: 'Revenue (USD)', targetDate: '2026-09' });
    expect(f.options.map((o: any) => o.price)).toEqual([113, 92.8]);
  });

  test('two pairs with the same impact: the date that settles last wins', async () => {
    await decided({
      id: 'p1',
      status: 'approved',
      at: '2026-09-05T10:00:00Z',
      pricing: [pair(TRADERS, '2026-W37', 12, 10), pair(TRADERS, '2026-09', 22, 20), pair(TRADERS, '2026-09-08', 5, 3)],
    });
    expect(forks((await get()).body)[0].metric.targetDate).toBe('2026-09');
  });

  test('a pair with a side nobody funded is not a pair to show', async () => {
    await decided({
      id: 'p1',
      status: 'approved',
      at: '2026-09-05T10:00:00Z',
      pricing: [pair(REVENUE, '2026-09', 500, null), pair(TRADERS, '2026-09', 18, 17)],
    });
    expect(forks((await get()).body)[0].metric.id).toBe(TRADERS);
  });

  test('nothing recorded: the fork keeps its words and shows no numbers', async () => {
    await decided({ id: 'p1', status: 'approved', at: '2026-09-05T10:00:00Z', pricing: null });
    const [f] = forks((await get()).body);
    expect(f.metric).toBeNull();
    expect(f.options.map((o: any) => o.price)).toEqual([null, null]);
  });

  test('the metric is named by its current name, not the one a market froze', async () => {
    await db.update(metrics).set({ name: 'Active traders (renamed)' }).where(eq(metrics.id, TRADERS));
    await decided({
      id: 'p1',
      status: 'approved',
      at: '2026-09-05T10:00:00Z',
      pricing: [pair(TRADERS, '2026-09', 18, 14)],
    });
    expect(forks((await get()).body)[0].metric.name).toBe('Active traders (renamed)');
  });
});

describe('PROPOSALS POSTED TOGETHER ARE ONE FORK: one question, several answers', () => {
  const move = (id: string, answer: string, status: string, price: number, created: string, by = 'snake') =>
    decided({
      id,
      by,
      status,
      at: '2026-09-11T17:50:58Z',
      title: `Game 1, attempt 88, move 6: ${answer}`,
      createdAt: created,
      decideBy: '2026-09-11T17:51:00Z',
      pricing: [pair(TRADERS, '2026-09-11T18:51', price, 2)],
    });

  test("the snake's three moves are one fork with one branch each, the approved one taken", async () => {
    await move('m1', 'Turn left', 'declined', 2.1, '2026-09-11T17:50:00.532Z');
    await move('m2', 'Continue forward', 'approved', 2.6, '2026-09-11T17:50:00.542Z');
    await move('m3', 'Turn right', 'declined', 1.9, '2026-09-11T17:50:00.563Z');
    const all = forks((await get()).body);
    expect(all).toHaveLength(1);
    const [f] = all;
    expect(f.verdict).toBe('chosen');
    expect(f.title).toBe('Game 1, attempt 88, move 6');
    expect(f.proposals.map((p: any) => p.id).sort()).toEqual(['m1', 'm2', 'm3']);
    expect(f.options).toEqual([
      { label: 'Continue forward', proposalId: 'm2', taken: true, price: 2.6 },
      { label: 'Turn left', proposalId: 'm1', taken: false, price: 2.1 },
      { label: 'Turn right', proposalId: 'm3', taken: false, price: 1.9 },
    ]);
  });

  test('a group none of whose proposals was approved takes none of them', async () => {
    await move('m1', 'Turn left', 'declined', 2.1, '2026-09-11T17:50:00.532Z');
    await move('m2', 'Turn right', 'declined', 1.9, '2026-09-11T17:50:00.563Z');
    const [f] = forks((await get()).body);
    expect(f.verdict).toBe('none');
    expect(f.options.every((o: any) => !o.taken)).toBe(true);
  });

  test('posted together but asking different things: titles sharing no question are separate forks', async () => {
    // An owner batch-posting unrelated proposals in one second with one
    // deadline has not asked one question with several answers.
    for (const [id, title, created] of [
      ['a', 'Hire a designer', '2026-09-11T17:50:00.100Z'],
      ['b', 'Sponsor a LessWrong post', '2026-09-11T17:50:00.200Z'],
    ]) {
      await decided({
        id,
        by: 'owner',
        status: 'approved',
        at: '2026-09-11T17:51:00Z',
        title,
        createdAt: created,
        decideBy: '2026-09-12T17:50:00Z',
      });
    }
    const all = forks((await get()).body);
    expect(all).toHaveLength(2);
    expect(all.map((f: any) => f.title).sort()).toEqual(['Hire a designer', 'Sponsor a LessWrong post']);
  });

  test('two proposers with the same deadline are two questions, not one', async () => {
    await move('m1', 'Turn left', 'approved', 2.1, '2026-09-11T17:50:00.532Z', 'snake');
    await move('m2', 'Turn right', 'declined', 1.9, '2026-09-11T17:50:00.563Z', 'jason');
    expect(forks((await get()).body)).toHaveLength(2);
  });

  test('one proposer, the same deadline, but posted more than ten seconds apart: two forks', async () => {
    await move('m1', 'Turn left', 'approved', 2.1, '2026-09-11T17:50:00Z');
    await move('m2', 'Turn right', 'declined', 1.9, '2026-09-11T17:50:30Z');
    expect(forks((await get()).body)).toHaveLength(2);
  });
});

describe('A BOOK THAT SETTLED IS A SQUARE ON THE TRUNK: the call against the value', () => {
  test('a settled baseline book carries the price its frozen book holds and the value it settled on', async () => {
    const shares: [number, number] = [0, 30];
    await book({ id: 'b1', targetDate: '2026-09-10', at: '2026-09-11T00:00:52Z', value: 7, shares });
    const [s] = settles((await get()).body);
    expect(s.at).toBe('2026-09-11T00:00:00.000Z');
    expect(s.books).toEqual([
      {
        marketId: 'b1',
        metricId: TRADERS,
        metricName: 'Active traders',
        targetDate: '2026-09-10',
        voided: false,
        value: 7,
        call: consensus(shares, 100, 0, 50),
      },
    ]);
  });

  test('a voided book says so and has no value', async () => {
    await book({ id: 'b1', targetDate: '2026', at: '2026-09-08T14:56:00Z', voided: true });
    const [b] = settles((await get()).body)[0].books;
    expect(b.voided).toBe(true);
    expect(b.value).toBeNull();
    expect(typeof b.call).toBe('number');
  });

  test('books settling in the same minute share one square; another minute is another square', async () => {
    await book({ id: 'b1', targetDate: '2026-09-10', at: '2026-09-11T00:00:10Z', value: 7 });
    await book({
      id: 'b2',
      metricId: REVENUE,
      metricName: 'Revenue (USD)',
      targetDate: '2026-09-10',
      at: '2026-09-11T00:00:52Z',
      value: 0,
    });
    await book({ id: 'b3', targetDate: '2026-09-09', at: '2026-09-10T00:00:10Z', value: 7 });
    const s = settles((await get()).body);
    expect(s.map((e: any) => e.books.length)).toEqual([2, 1]);
  });

  test("a proposal's own books are part of its fork, never trunk squares", async () => {
    await decided({ id: 'p1', status: 'approved', at: '2026-09-05T10:00:00Z' });
    await book({
      id: 'b-d',
      targetDate: '2026-09',
      proposalId: 'p1',
      branch: 'declined',
      voided: true,
      at: '2026-09-05T10:00:00Z',
    });
    await book({
      id: 'b-a',
      targetDate: '2026-09-04',
      proposalId: 'p1',
      branch: 'approved',
      at: '2026-09-05T00:00:00Z',
      value: 3,
    });
    expect(settles((await get()).body)).toEqual([]);
  });

  test('an open book is not history', async () => {
    await book({ id: 'b1', targetDate: '2026-09', at: null });
    expect((await get()).body.events).toEqual([]);
  });
});

describe('THE TIP IS WHAT IS BEING DECIDED NOW', () => {
  test('a pending proposal is an open fork on the first page, priced on its books now', async () => {
    await decided({ id: 'p1', status: 'pending', at: '2026-09-11T10:00:00Z', title: 'Improve the proposal page' });
    const shares: [number, number] = [0, 40];
    await book({ id: 'b-a', targetDate: '2026-09', proposalId: 'p1', branch: 'approved', shares });
    await book({ id: 'b-d', targetDate: '2026-09', proposalId: 'p1', branch: 'declined' });
    const res = await get();
    expect(res.body.events).toEqual([]);
    expect(res.body.open).toHaveLength(1);
    const [f] = res.body.open;
    expect(f.verdict).toBe('open');
    expect(f.title).toBe('Improve the proposal page');
    expect(f.options.every((o: any) => !o.taken)).toBe(true);
    expect(f.options[0]).toMatchObject({ label: 'if approved', price: consensus(shares, 100, 0, 50) });
    expect(f.options[1]).toMatchObject({ label: 'if declined', price: consensus([0, 0], 100, 0, 50) });
  });

  test('an older page has no tip', async () => {
    await decided({ id: 'p1', status: 'pending', at: '2026-09-11T10:00:00Z' });
    const res = await get('?before=2026-09-10T00:00:00Z');
    expect(res.body.open).toEqual([]);
  });
});

describe('NEWEST FIRST, AND A PAGE NEVER SPLITS A FORK', () => {
  test('events come newest first, forks and squares interleaved by instant', async () => {
    await decided({ id: 'old', status: 'approved', at: '2026-09-01T10:00:00Z' });
    await book({ id: 'b1', targetDate: '2026-09-02', at: '2026-09-03T00:00:00Z', value: 4 });
    await decided({ id: 'new', status: 'declined', at: '2026-09-05T10:00:00Z' });
    const kinds = (await get()).body.events.map(
      (e: any) => e.kind + ':' + (e.proposals?.[0].id ?? e.books[0].marketId),
    );
    expect(kinds).toEqual(['fork:new', 'settle:b1', 'fork:old']);
  });

  test('paging walks every event once, never repeating or skipping one', async () => {
    for (let i = 0; i < 7; i++) {
      await decided({ id: `p${i}`, status: 'approved', at: `2026-09-0${i + 1}T10:00:00Z` });
      await book({ id: `b${i}`, targetDate: `2026-08-2${i}`, at: `2026-09-0${i + 1}T00:00:00Z`, value: i });
    }
    const seen: string[] = [];
    let before = '';
    for (let n = 0; n < 20; n++) {
      const res = await get(`?limit=3${before ? `&before=${encodeURIComponent(before)}` : ''}`);
      expect(res.status).toBe(200);
      for (const e of res.body.events) seen.push(e.kind === 'fork' ? e.proposals[0].id : e.books[0].marketId);
      if (!res.body.next) break;
      before = res.body.next;
    }
    expect(seen).toHaveLength(14);
    expect(new Set(seen).size).toBe(14);
  });

  test('a fork of three moves is never cut across two pages', async () => {
    // Twelve moves, three per minute: four forks. Whatever the page size, each
    // fork arrives whole on exactly one page.
    for (let mv = 1; mv <= 4; mv++) {
      for (const [k, answer] of ['Turn left', 'Continue forward', 'Turn right'].entries()) {
        await decided({
          id: `m${mv}-${k}`,
          by: 'snake',
          status: k === 1 ? 'approved' : 'declined',
          at: `2026-09-11T17:5${mv}:58.${k}00Z`,
          title: `Game 1, attempt 88, move ${mv}: ${answer}`,
          createdAt: `2026-09-11T17:5${mv - 1}:00.${k}00Z`,
          decideBy: `2026-09-11T17:5${mv}:00Z`,
        });
      }
    }
    for (const limit of [1, 2, 3]) {
      const got: string[][] = [];
      let before = '';
      for (let n = 0; n < 20; n++) {
        const res = await get(`?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`);
        for (const f of forks(res.body)) got.push(f.proposals.map((p: any) => p.id).sort());
        if (!res.body.next) break;
        before = res.body.next;
      }
      expect(got).toHaveLength(4);
      for (const ids of got) expect(ids).toHaveLength(3);
    }
  });

  test('a limit outside 1..200 or a before that is not an instant is a 400, not a guess', async () => {
    expect((await get('?limit=0')).status).toBe(400);
    expect((await get('?limit=201')).status).toBe(400);
    expect((await get('?limit=abc')).status).toBe(400);
    expect((await get('?before=yesterday')).status).toBe(400);
  });
});

describe('WHAT THE TREE HOLDS IS COUNTED', () => {
  test('decided, settled and voided are counted whatever the page, and since is the oldest event', async () => {
    await decided({ id: 'p1', status: 'approved', at: '2026-09-05T10:00:00Z' });
    await decided({ id: 'p2', status: 'declined', at: '2026-09-06T10:00:00Z' });
    await decided({ id: 'p3', status: 'pending', at: '2026-09-07T10:00:00Z' });
    await book({ id: 'b1', targetDate: '2026-09-01', at: '2026-09-02T00:00:00Z', value: 4 });
    await book({ id: 'b2', targetDate: '2026', at: '2026-09-08T00:00:00Z', voided: true });
    const res = await get('?limit=1');
    expect(res.body.counts).toEqual({ decided: 2, settled: 1, voided: 1 });
    expect(res.body.since).toBe('2026-09-02T00:00:00.000Z');
    expect(res.body.workspace).toEqual({ slug: 'telarchy', name: 'Telarchy' });
  });

  test('an empty floor is an empty tree, not an error', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      events: [],
      open: [],
      next: null,
      since: null,
      counts: { decided: 0, settled: 0, voided: 0 },
    });
  });
});

describe('THE SAME DISCLOSURE RULE AS THE ANNOUNCEMENTS', () => {
  test('an unknown floor is a 404', async () => {
    expect((await get('', 'no-such-floor')).status).toBe(404);
  });

  test('a private floor is a 403', async () => {
    await db.update(workspaces).set({ visibility: 'private' }).where(eq(workspaces.id, WS));
    expect((await get('', WS)).status).toBe(403);
  });

  test('a floor whose Public group cannot read is a 403', async () => {
    await db
      .update(permissionGroups)
      .set({ capabilities: ['trade'] })
      .where(eq(permissionGroups.id, 'grp-pub'));
    expect((await get()).status).toBe(403);
  });
});
