/**
 * The floor's time axis (docs/owner-on-the-floor.md, "What is planned"):
 * GET /api/marketplace/:idOrSlug/timeline, one bar per committed interval,
 * computed here and nowhere else. The tests pin which rows become bars, where
 * each bar starts and ends, and the rules that take a bar OFF the axis, one
 * test per rule, because a stale bar on a public floor is a promise the owner
 * never made.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  getAuthWorkspaceMemberships: async () => [],
}));

jest.mock('../middleware/roles', () => ({
  requireCapability: () => (_req: any, _res: any, next: any) => next(),
  requireIdentity: (_req: any, _res: any, next: any) => next(),
}));

import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, permissionGroups, plans, proposals, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { marketplaceRouter } from '../routes/marketplace';
import { buildTimeline, sortTimelineItems, type TimelineItem } from '../services/timeline';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const WS = 'ws-tl';
const SLUG = 'timeline-ws';
const T = (s: string) => new Date(s);
const NOW = T('2026-09-11T12:00:00.000Z');

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

async function seed(publicCaps: string[] = ['read', 'trade'], visibility = 'public') {
  await db.insert(agents).values({ id: 'agent-tl', apiKeyHash: 'h-tl', balance: 0, nickname: 'owner' });
  await db.insert(workspaces).values({ id: WS, name: 'Timeline WS', createdBy: 'agent-tl', visibility, slug: SLUG });
  await db.insert(permissionGroups).values({
    id: 'grp-pub-tl',
    workspaceId: WS,
    name: 'Public',
    type: 'public',
    capabilities: publicCaps,
    memberIds: [],
  });
  await db.insert(metrics).values({ id: 'met-1', workspaceId: WS, name: 'Active forecasters' });
}

type MarketOverrides = Partial<typeof markets.$inferInsert> & { id: string };
async function market(o: MarketOverrides) {
  await db.insert(markets).values({
    workspaceId: WS,
    metricId: 'met-1',
    metricName: 'Old metric name',
    targetDate: '2026-09',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 10,
    pool: 10,
    ...o,
  });
}

type ProposalOverrides = Partial<typeof proposals.$inferInsert> & { id: string; number: number };
async function proposal(o: ProposalOverrides) {
  await db.insert(proposals).values({
    workspaceId: WS,
    proposedBy: 'agent-tl',
    title: `Proposal ${o.number}`,
    createdAt: T('2026-09-01T09:00:00.000Z'),
    ...o,
  });
}

async function items(now = NOW): Promise<TimelineItem[]> {
  return buildTimeline(db, { id: WS, slug: SLUG }, now);
}

describe('disclosure, the same rule as the announcements', () => {
  test('an unknown floor is 404', async () => {
    await seed();
    const res = await request(app).get('/api/marketplace/nobody-here/timeline');
    expect(res.status).toBe(404);
  });

  test('a private floor is 403', async () => {
    await seed(['read'], 'private');
    const res = await request(app).get(`/api/marketplace/${WS}/timeline`);
    expect(res.status).toBe(403);
  });

  test('a floor whose Public group lacks read is 403', async () => {
    await seed([]);
    const res = await request(app).get(`/api/marketplace/${SLUG}/timeline`);
    expect(res.status).toBe(403);
  });

  test('an open floor answers by slug with now and items', async () => {
    await seed();
    await db
      .insert(plans)
      .values({ id: 'pl-1', workspaceId: WS, title: 'Write the results post', due: T('2026-09-20T00:00:00.000Z') });
    const res = await request(app).get(`/api/marketplace/${SLUG}/timeline`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toEqual({
      kind: 'plan',
      id: 'pl-1',
      title: 'Write the results post',
      description: null,
      start: null,
      end: '2026-09-20T00:00:00.000Z',
      href: null,
      done: false,
    });
  });

  test('now is the server clock', async () => {
    await seed();
    const before = Date.now();
    const res = await request(app).get(`/api/marketplace/${SLUG}/timeline`);
    const now = new Date(res.body.now).getTime();
    expect(now).toBeGreaterThanOrEqual(before - 1000);
    expect(now).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('an approved proposal not yet delivered', () => {
  test('runs from the approval to its earliest unresolved horizon', async () => {
    await seed();
    await proposal({ id: 'p-1', number: 7, status: 'approved', resolvedAt: T('2026-09-05T10:00:00.000Z') });
    await market({
      id: 'm-a1',
      proposalId: 'p-1',
      branch: 'approved',
      targetDate: '2026-10',
      settlesAt: T('2026-11-01T06:00:00.000Z'),
    });
    await market({
      id: 'm-d1',
      proposalId: 'p-1',
      branch: 'declined',
      targetDate: '2026-10',
      settlesAt: T('2026-11-01T06:00:00.000Z'),
    });
    await market({
      id: 'm-a2',
      proposalId: 'p-1',
      branch: 'approved',
      targetDate: '2026-09',
      settlesAt: T('2026-10-01T06:00:00.000Z'),
    });
    const got = await items();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      kind: 'proposal',
      id: 'p-1',
      title: 'Proposal 7',
      start: '2026-09-05T10:00:00.000Z',
      end: '2026-10-01T06:00:00.000Z',
      href: `/${SLUG}/p/7`,
    });
  });

  test('a horizon that has settled no longer sets the end', async () => {
    await seed();
    await proposal({ id: 'p-1', number: 7, status: 'approved', resolvedAt: T('2026-09-05T10:00:00.000Z') });
    await market({
      id: 'm-a1',
      proposalId: 'p-1',
      branch: 'approved',
      targetDate: '2026-09-10',
      resolved: true,
      resolvedAt: T('2026-09-11T00:00:00.000Z'),
    });
    await market({
      id: 'm-a2',
      proposalId: 'p-1',
      branch: 'approved',
      targetDate: '2026-10',
      settlesAt: T('2026-11-01T00:00:00.000Z'),
    });
    const got = await items();
    expect(got.map(i => i.end)).toEqual(['2026-11-01T00:00:00.000Z']);
  });

  test('an approved proposal with every horizon resolved has no bar', async () => {
    await seed();
    await proposal({ id: 'p-1', number: 7, status: 'approved', resolvedAt: T('2026-09-05T10:00:00.000Z') });
    await market({ id: 'm-a1', proposalId: 'p-1', branch: 'approved', targetDate: '2026-09-10', resolved: true });
    await market({ id: 'm-a2', proposalId: 'p-1', branch: 'approved', targetDate: '2026-09-11', active: false });
    expect(await items()).toEqual([]);
  });

  test('a delivered proposal leaves the axis', async () => {
    await seed();
    await proposal({
      id: 'p-1',
      number: 7,
      status: 'approved',
      resolvedAt: T('2026-09-05T10:00:00.000Z'),
      deliveredAt: T('2026-09-09T10:00:00.000Z'),
      deliveryState: 'delivered',
    });
    await market({ id: 'm-a1', proposalId: 'p-1', branch: 'approved', targetDate: '2026-10' });
    expect(await items()).toEqual([]);
  });
});

describe('a pending proposal', () => {
  test('a pending proposal ends at its decision deadline', async () => {
    await seed();
    await proposal({
      id: 'p-2',
      number: 8,
      status: 'pending',
      createdAt: T('2026-09-10T09:00:00.000Z'),
      decideBy: T('2026-09-12T09:00:00.000Z'),
    });
    await market({ id: 'm-a1', proposalId: 'p-2', branch: 'approved', targetDate: '2026-10' });
    const got = await items();
    expect(got).toEqual([
      {
        kind: 'decision',
        id: 'p-2',
        title: 'Proposal 8',
        start: '2026-09-10T09:00:00.000Z',
        end: '2026-09-12T09:00:00.000Z',
        href: `/${SLUG}/p/8`,
      },
    ]);
  });

  test('a pending proposal from before deadlines existed has no end', async () => {
    await seed();
    await proposal({ id: 'p-2', number: 8, status: 'pending', decideBy: null });
    const got = await items();
    expect(got).toHaveLength(1);
    expect(got[0].end).toBeNull();
  });

  test('a decided, lapsed or withdrawn proposal leaves the axis', async () => {
    await seed();
    await proposal({
      id: 'p-3',
      number: 9,
      status: 'declined',
      resolvedAt: T('2026-09-06T00:00:00.000Z'),
      decideBy: T('2026-09-20T00:00:00.000Z'),
    });
    await proposal({
      id: 'p-4',
      number: 10,
      status: 'declined',
      lapsedAt: T('2026-09-06T00:00:00.000Z'),
      decideBy: T('2026-09-06T00:00:00.000Z'),
    });
    await proposal({
      id: 'p-5',
      number: 11,
      status: 'withdrawn',
      resolvedAt: T('2026-09-06T00:00:00.000Z'),
      decideBy: T('2026-09-20T00:00:00.000Z'),
    });
    await proposal({ id: 'p-6', number: 12, status: 'declined_spam', resolvedAt: T('2026-09-06T00:00:00.000Z') });
    await proposal({ id: 'p-7', number: 13, status: 'removed' });
    expect(await items()).toEqual([]);
  });
});

describe('an open baseline book', () => {
  test('runs from the start of its period to the day it settles, under the current metric name', async () => {
    await seed();
    await market({ id: 'm-b1', targetDate: '2026-09', settlesAt: T('2026-10-01T02:00:00.000Z') });
    const got = await items();
    expect(got).toEqual([
      {
        kind: 'book',
        id: 'm-b1',
        title: 'Active forecasters · 2026-09',
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-10-01T02:00:00.000Z',
        href: `/${SLUG}#market=m-b1`,
      },
    ]);
  });

  test('a book of a metric since removed keeps the name it froze', async () => {
    await seed();
    await market({ id: 'm-b1', metricId: 'met-gone', metricName: 'Frozen name', targetDate: '2026-W38' });
    const got = await items();
    expect(got[0].title).toBe('Frozen name · 2026-W38');
    // No settlesAt on the row: the period end is the settlement, as before 2026-08-31.
    expect(got[0].start).toBe('2026-09-14T00:00:00.000Z');
    expect(got[0].end).toBe('2026-09-21T00:00:00.000Z');
  });

  test('a settled book leaves the axis', async () => {
    await seed();
    await market({ id: 'm-b1', targetDate: '2026-08', resolved: true, resolvedAt: T('2026-09-01T00:00:00.000Z') });
    expect(await items()).toEqual([]);
  });

  test('a voided book leaves the axis', async () => {
    await seed();
    await market({ id: 'm-b1', targetDate: '2026-09', voided: true });
    await market({ id: 'm-b2', targetDate: '2026-10', active: false });
    expect(await items()).toEqual([]);
  });

  test("a proposal's own books are not baseline bars", async () => {
    await seed();
    await proposal({ id: 'p-1', number: 7, status: 'approved', resolvedAt: T('2026-09-05T10:00:00.000Z') });
    await market({ id: 'm-a1', proposalId: 'p-1', branch: 'approved', targetDate: '2026-10' });
    await market({ id: 'm-d1', proposalId: 'p-1', branch: 'declined', targetDate: '2026-10' });
    const got = await items();
    expect(got.map(i => i.kind)).toEqual(['proposal']);
  });
});

describe('a plan item', () => {
  test('runs from the owner start to the owner due, with its words', async () => {
    await seed();
    await db.insert(plans).values({
      id: 'pl-1',
      workspaceId: WS,
      title: 'Call with Seer',
      description: 'Thursday, about liquidity.',
      start: T('2026-09-15T09:00:00.000Z'),
      due: T('2026-09-17T14:00:00.000Z'),
      createdBy: 'agent-tl',
    });
    const got = await items();
    expect(got).toEqual([
      {
        kind: 'plan',
        id: 'pl-1',
        title: 'Call with Seer',
        description: 'Thursday, about liquidity.',
        start: '2026-09-15T09:00:00.000Z',
        end: '2026-09-17T14:00:00.000Z',
        href: null,
        done: false,
      },
    ]);
  });

  test('a plan with no start still appears', async () => {
    await seed();
    await db
      .insert(plans)
      .values({ id: 'pl-1', workspaceId: WS, title: 'Undated start', due: T('2026-09-17T14:00:00.000Z') });
    const got = await items();
    expect(got).toHaveLength(1);
    expect(got[0].start).toBeNull();
    expect(got[0].end).toBe('2026-09-17T14:00:00.000Z');
  });

  test('a plan with no due date appears with a null end', async () => {
    await seed();
    await db.insert(plans).values({ id: 'pl-1', workspaceId: WS, title: 'Someday' });
    const got = await items();
    expect(got).toHaveLength(1);
    expect(got[0].end).toBeNull();
  });

  test('a done plan leaves the axis', async () => {
    await seed();
    await db.insert(plans).values({
      id: 'pl-1',
      workspaceId: WS,
      title: 'Done thing',
      due: T('2026-09-17T14:00:00.000Z'),
      doneAt: T('2026-09-11T10:00:00.000Z'),
    });
    expect(await items()).toEqual([]);
  });

  test("another floor's plans are not here", async () => {
    await seed();
    await db
      .insert(workspaces)
      .values({ id: 'ws-other', name: 'Other', createdBy: 'agent-tl', visibility: 'public', slug: 'other' });
    await db.insert(plans).values({ id: 'pl-x', workspaceId: 'ws-other', title: 'Not ours' });
    expect(await items()).toEqual([]);
  });
});

describe('order', () => {
  test('items sort by end ascending with undated last', async () => {
    const mk = (id: string, end: string | null): TimelineItem => ({
      kind: 'plan',
      id,
      title: id,
      start: null,
      end,
      href: null,
    });
    const sorted = sortTimelineItems([
      mk('c', null),
      mk('b', '2026-09-20T00:00:00.000Z'),
      mk('a', '2026-09-12T00:00:00.000Z'),
      mk('d', null),
    ]);
    expect(sorted.map(i => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('the route returns every kind together, soonest end first', async () => {
    await seed();
    await proposal({ id: 'p-1', number: 7, status: 'approved', resolvedAt: T('2026-09-05T10:00:00.000Z') });
    await market({
      id: 'm-a1',
      proposalId: 'p-1',
      branch: 'approved',
      targetDate: '2026-10',
      settlesAt: T('2026-11-01T00:00:00.000Z'),
    });
    await proposal({ id: 'p-2', number: 8, status: 'pending', decideBy: T('2026-09-12T09:00:00.000Z') });
    await market({ id: 'm-b1', targetDate: '2026-09', settlesAt: T('2026-10-01T00:00:00.000Z') });
    await db.insert(plans).values({ id: 'pl-1', workspaceId: WS, title: 'Someday' });
    await db.insert(plans).values({ id: 'pl-2', workspaceId: WS, title: 'Soon', due: T('2026-09-11T18:00:00.000Z') });
    const res = await request(app).get(`/api/marketplace/${SLUG}/timeline`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: TimelineItem) => `${i.kind}:${i.id}`)).toEqual([
      'plan:pl-2',
      'decision:p-2',
      'book:m-b1',
      'proposal:p-1',
      'plan:pl-1',
    ]);
  });
});
