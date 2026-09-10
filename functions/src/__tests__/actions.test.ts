/**
 * The public actions log (docs/data-room.md).
 *
 * The log is the data room now, and the rules it exists to enforce are the
 * ones pinned here: it answers anonymously; a private floor contributes
 * nothing; a redemption is never a row; a removed proposal is absent; a page
 * never repeats or skips a row; the cap holds; every kind the doc names
 * renders a sentence and an address; a typo in a filter is a 400, never an
 * empty list; and nothing in the response is an email, an address or a
 * private name.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = null;
    next();
  },
  optionalAuthMiddleware: (req: any, _res: any, next: any) => {
    req.auth = req.auth ?? null;
    next();
  },
}));

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import {
  agents,
  announcements,
  authUser,
  creditTransfers,
  earnClaims,
  earnRules,
  limitOrders,
  liquidityEvents,
  liquidityPurchases,
  marketMessages,
  markets,
  metricDefinitionRevisions,
  metrics,
  permissionGroups,
  prizeSeasons,
  proposalMessages,
  proposalRevisions,
  proposals,
  recordLinks,
  seasonEntries,
  trades,
  updates,
  workspaces,
} from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { toUnits } from '../lib/validation';
import { dataRoomRouter } from '../routes/data-room';
import { marketplaceRouter } from '../routes/marketplace';
import { actionsTool, buildActions, KINDS, renderActionsText } from '../services/actions';
import { clearDataRoomCache } from '../services/data-room';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/data-room', dataRoomRouter);
app.use('/api/marketplace', marketplaceRouter);
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const PUB = 'ws-telarchy';
const PRIV = 'ws-secret';
const T = (s: string) => new Date(s);

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);
beforeEach(async () => {
  await truncateAll();
  clearDataRoomCache();
  delete process.env.SELF_SYNC_WORKSPACE_ID;
});

async function seedFloors() {
  await db.insert(workspaces).values([
    {
      id: PUB,
      name: 'Telarchy',
      slug: 'telarchy',
      createdBy: 'seed',
      visibility: 'public',
      createdAt: T('2026-08-01'),
    },
    {
      id: PRIV,
      name: 'Secret Co',
      slug: 'secret',
      createdBy: 'seed',
      visibility: 'private',
      createdAt: T('2026-08-02'),
    },
  ]);
  await db.insert(authUser).values([
    {
      id: 'u1',
      name: 'Vire Person',
      email: 'vire@example.com',
      emailVerified: true,
      createdAt: T('2026-08-03'),
      updatedAt: T('2026-08-03'),
    },
  ]);
  await db.insert(agents).values([
    {
      id: 'a1',
      apiKeyHash: 'h1',
      balance: toUnits(100),
      nickname: 'vire',
      authUserId: 'u1',
      createdAt: T('2026-08-03T10:00:00Z'),
    },
    {
      id: 'a2',
      apiKeyHash: 'h2',
      balance: toUnits(100),
      nickname: 'vire-bot',
      ownerAgentId: 'a1',
      createdAt: T('2026-08-04T10:00:00Z'),
    },
    { id: 'a3', apiKeyHash: 'h3', balance: toUnits(100), createdAt: T('2026-08-05T10:00:00Z') },
  ]);
  await db.insert(metrics).values([
    {
      id: 'm1',
      workspaceId: PUB,
      name: 'Active traders',
      value: 4,
      formula: '0',
      marketRangeMax: 50,
      createdAt: T('2026-08-06'),
    },
    {
      id: 'm9',
      workspaceId: PRIV,
      name: 'Secret number',
      value: 4,
      formula: '0',
      marketRangeMax: 50,
      createdAt: T('2026-08-06'),
    },
  ]);
  const book = (id: string, ws: string, extra: Record<string, unknown> = {}) => ({
    id,
    workspaceId: ws,
    metricId: ws === PUB ? 'm1' : 'm9',
    metricName: ws === PUB ? 'Active traders' : 'Secret number',
    targetDate: '2026-09',
    rangeMin: 0,
    rangeMax: 50,
    shares: [0, 0] as [number, number],
    liquidity: 100,
    pool: initialPool(100),
    active: true,
    resolved: false,
    voided: false,
    createdAt: T('2026-08-07'),
    ...extra,
  });
  await db.insert(markets).values([
    book('mkt1', PUB),
    book('mkt-pair', PUB, { proposalId: 'p1', branch: 'approved', createdAt: T('2026-08-08') }),
    book('mkt-done', PUB, {
      resolved: true,
      resolvedAt: T('2026-08-20'),
      actualValue: 7,
      active: false,
      createdAt: T('2026-08-01'),
    }),
    book('mkt-void', PUB, {
      resolved: true,
      resolvedAt: T('2026-08-21'),
      voided: true,
      active: false,
      createdAt: T('2026-08-01'),
    }),
    book('mkt9', PRIV),
  ]);
}

/** One of every kind, so a test can assert the whole vocabulary renders. */
async function seedEverything() {
  await seedFloors();
  await db.insert(trades).values([
    {
      id: 't-buy',
      workspaceId: PUB,
      agentId: 'a1',
      marketId: 'mkt1',
      direction: 'higher',
      shares: 10,
      cost: 40,
      kind: 'trade',
      consensusBefore: 4,
      consensusAfter: 5.2,
      createdAt: T('2026-08-10T09:00:00Z'),
    },
    {
      id: 't-sell',
      workspaceId: PUB,
      agentId: 'a1',
      marketId: 'mkt1',
      direction: 'higher',
      shares: -4,
      cost: -15,
      kind: 'trade',
      consensusBefore: 5.2,
      consensusAfter: 4.9,
      createdAt: T('2026-08-10T09:05:00Z'),
    },
    {
      id: 't-redeem',
      workspaceId: PUB,
      agentId: 'a1',
      marketId: 'mkt1',
      direction: 'lower',
      shares: -1,
      cost: 0,
      kind: 'redeem',
      createdAt: T('2026-08-10T09:06:00Z'),
    },
    {
      id: 't-private',
      workspaceId: PRIV,
      agentId: 'a1',
      marketId: 'mkt9',
      direction: 'higher',
      shares: 10,
      cost: 40,
      kind: 'trade',
      createdAt: T('2026-08-10T09:07:00Z'),
    },
  ]);
  await db.insert(liquidityEvents).values([
    {
      id: 'lq-init',
      workspaceId: PUB,
      marketId: 'mkt1',
      amount: 100,
      totalLiquidity: 100,
      type: 'initial',
      createdAt: T('2026-08-07'),
    },
    {
      id: 'lq-add',
      workspaceId: PUB,
      marketId: 'mkt1',
      amount: 250,
      totalLiquidity: 350,
      type: 'injection',
      agentId: 'a1',
      createdAt: T('2026-08-11T12:00:00Z'),
    },
  ]);
  await db.insert(proposals).values([
    {
      id: 'p1',
      workspaceId: PUB,
      proposedBy: 'a1',
      title: 'Open job',
      status: 'pending',
      askUsd: 50,
      number: 1,
      createdAt: T('2026-08-12'),
    },
    {
      id: 'p2',
      workspaceId: PUB,
      proposedBy: 'a1',
      title: 'Paid job',
      status: 'approved',
      askUsd: 100,
      number: 2,
      createdAt: T('2026-08-12'),
      resolvedAt: T('2026-08-13'),
      resolvedBy: 'a3',
      deliveryState: 'delivered',
      deliveredAt: T('2026-08-14'),
      deliveryNote: 'Shipped it',
    },
    {
      id: 'p3',
      workspaceId: PUB,
      proposedBy: 'a2',
      title: 'Declined job',
      status: 'declined',
      askUsd: 250,
      number: 3,
      createdAt: T('2026-08-12'),
      resolvedAt: T('2026-08-15'),
      resolvedBy: 'a3',
      declineReason: 'Too expensive',
    },
    {
      id: 'p4',
      workspaceId: PUB,
      proposedBy: 'a2',
      title: 'Lapsed job',
      status: 'lapsed',
      askUsd: 10,
      number: 4,
      createdAt: T('2026-08-12'),
      lapsedAt: T('2026-08-16'),
    },
    {
      id: 'p5',
      workspaceId: PUB,
      proposedBy: 'a2',
      title: 'Withdrawn job',
      status: 'withdrawn',
      askUsd: 10,
      number: 5,
      createdAt: T('2026-08-12'),
      closedAt: T('2026-08-17'),
    },
    {
      id: 'p6',
      workspaceId: PUB,
      proposedBy: 'a2',
      title: 'Spam row',
      status: 'removed',
      askUsd: 10,
      number: 6,
      createdAt: T('2026-08-12'),
      resolvedAt: T('2026-08-18'),
    },
    {
      id: 'p9',
      workspaceId: PRIV,
      proposedBy: 'a1',
      title: 'Private job',
      status: 'pending',
      askUsd: 10,
      number: 1,
      createdAt: T('2026-08-12'),
    },
  ]);
  await db.insert(proposalRevisions).values([
    {
      id: 'pr1',
      workspaceId: PUB,
      proposalId: 'p1',
      field: 'title',
      oldValue: 'Open jbo',
      newValue: 'Open job',
      changedBy: 'a1',
      createdAt: T('2026-08-12T13:00:00Z'),
    },
  ]);
  await db.insert(proposalMessages).values([
    {
      id: 'pm1',
      workspaceId: PUB,
      proposalId: 'p1',
      from: 'a3',
      content:
        'Is this priced against the weekly book or the monthly one? Asking because the two differ by a lot right now and the title does not say.',
      createdAt: T('2026-08-12T14:00:00Z'),
    },
    {
      id: 'pm9',
      workspaceId: PRIV,
      proposalId: 'p9',
      from: 'a3',
      content: 'private comment',
      createdAt: T('2026-08-12T14:00:00Z'),
    },
  ]);
  await db.insert(marketMessages).values([
    {
      id: 'mm1',
      workspaceId: PUB,
      marketId: 'mkt1',
      from: 'a1',
      content: 'Cheap at 4.',
      createdAt: T('2026-08-12T15:00:00Z'),
    },
  ]);
  await db.insert(announcements).values([
    {
      id: 'an1',
      workspaceId: PUB,
      body: 'We are live on the floor today.',
      publishedAt: T('2026-08-19T08:00:00Z'),
      editedAt: T('2026-08-19T09:00:00Z'),
      originalBody: 'We are live.',
      publishedBy: 'a3',
    },
    { id: 'an9', workspaceId: PRIV, body: 'Private news.', publishedAt: T('2026-08-19T08:00:00Z') },
  ]);
  await db.insert(updates).values([
    {
      id: 'up1',
      workspaceId: PUB,
      metricName: 'Active traders',
      oldValue: 4,
      newValue: 6,
      description: 'hourly self-sync',
      timestamp: T('2026-08-22T10:00:00Z'),
    },
    {
      id: 'up9',
      workspaceId: PRIV,
      metricName: 'Secret number',
      oldValue: 4,
      newValue: 6,
      description: 'x',
      timestamp: T('2026-08-22T10:00:00Z'),
    },
  ]);
  await db.insert(metricDefinitionRevisions).values([
    {
      id: 'md1',
      workspaceId: PUB,
      metricId: 'm1',
      field: 'description',
      oldValue: 'old words',
      newValue: 'new words',
      changedBy: 'a3',
      createdAt: T('2026-08-23T10:00:00Z'),
    },
  ]);
  await db.insert(recordLinks).values([
    {
      agentId: 'a1',
      provider: 'manifold',
      externalId: 'x1',
      handle: 'vire-on-manifold',
      linkedAt: T('2026-08-24T10:00:00Z'),
    },
  ]);
  await db.insert(limitOrders).values([
    {
      id: 'lo-open',
      workspaceId: PUB,
      marketId: 'mkt1',
      agentId: 'a1',
      direction: 'lower',
      limitValue: 3,
      budgetCredits: 200,
      status: 'open',
      createdAt: T('2026-08-25T10:00:00Z'),
      updatedAt: T('2026-08-25T10:00:00Z'),
    },
    {
      id: 'lo-filled',
      workspaceId: PUB,
      marketId: 'mkt1',
      agentId: 'a1',
      direction: 'higher',
      limitValue: 6,
      budgetCredits: 50,
      filledCredits: 50,
      status: 'filled',
      createdAt: T('2026-08-25T11:00:00Z'),
      updatedAt: T('2026-08-25T12:00:00Z'),
    },
    {
      id: 'lo-private',
      workspaceId: PRIV,
      marketId: 'mkt9',
      agentId: 'a1',
      direction: 'higher',
      limitValue: 6,
      budgetCredits: 50,
      status: 'open',
      createdAt: T('2026-08-25T11:00:00Z'),
      updatedAt: T('2026-08-25T11:00:00Z'),
    },
  ]);
  await db.insert(liquidityEvents).values([
    // A subsidy lands on every branch book of the proposal at once: three
    // rows in the same minute, one row on the log.
    {
      id: 'sub-1',
      workspaceId: PUB,
      marketId: 'mkt-pair',
      amount: 100,
      totalLiquidity: 200,
      type: 'proposal-subsidy',
      agentId: 'a3',
      createdAt: T('2026-08-26T10:00:01Z'),
    },
    {
      id: 'sub-2',
      workspaceId: PUB,
      marketId: 'mkt-pair',
      amount: 100,
      totalLiquidity: 300,
      type: 'proposal-subsidy',
      agentId: 'a3',
      createdAt: T('2026-08-26T10:00:02Z'),
    },
    {
      id: 'sub-3',
      workspaceId: PUB,
      marketId: 'mkt-pair',
      amount: 50,
      totalLiquidity: 350,
      type: 'proposal-subsidy',
      agentId: 'a3',
      createdAt: T('2026-08-26T10:00:03Z'),
    },
    {
      id: 'anchor-1',
      workspaceId: PUB,
      marketId: 'mkt1',
      amount: 5,
      totalLiquidity: 355,
      type: 'anchor',
      createdAt: T('2026-08-26T11:00:00Z'),
    },
  ]);
  await db.insert(liquidityPurchases).values([
    {
      id: 'buy-1',
      workspaceId: PUB,
      agentId: 'a1',
      usdAmount: 5,
      credits: 5000,
      creditsPerUsd: 1000,
      status: 'completed',
      createdAt: T('2026-08-27T09:00:00Z'),
      completedAt: T('2026-08-27T09:05:00Z'),
    },
    {
      id: 'buy-pending',
      workspaceId: PUB,
      agentId: 'a1',
      usdAmount: 50,
      credits: 50000,
      creditsPerUsd: 1000,
      status: 'pending',
      createdAt: T('2026-08-27T10:00:00Z'),
    },
  ]);
  await db
    .insert(earnRules)
    .values([{ key: 'manifold_link', label: 'Link your Manifold record', credits: 1000, kind: 'flat' }]);
  await db.insert(earnClaims).values([
    {
      id: 'claim-1',
      agentId: 'a1',
      key: 'manifold_link',
      refId: 'x1',
      credits: 1000,
      createdAt: T('2026-08-24T10:01:00Z'),
    },
    {
      id: 'claim-2',
      agentId: 'a3',
      key: 'daily_trade',
      credits: 50,
      period: '2026-08-28',
      createdAt: T('2026-08-28T10:00:00Z'),
    },
  ]);
  await db.insert(creditTransfers).values([
    {
      id: 'tr-1',
      fromAgentId: 'a1',
      toAgentId: 'a3',
      credits: 250,
      memo: 'a private note between them',
      createdAt: T('2026-08-29T10:00:00Z'),
    },
    {
      id: 'tr-back',
      fromAgentId: 'a3',
      toAgentId: 'a1',
      credits: 100,
      memo: 'reversal',
      createdAt: T('2026-08-29T11:00:00Z'),
    },
  ]);
  await db.insert(prizeSeasons).values([
    {
      id: 'season-0',
      name: 'Season 0',
      startsAt: T('2026-08-01'),
      endsAt: T('2026-10-01'),
      poolUsd: 500,
      ladder: [],
      workspaceIds: [],
      rulesUrl: '/legal/season-0',
    },
  ]);
  await db.insert(seasonEntries).values([
    { seasonId: 'season-0', agentId: 'a1', optedIn: true, enteredAt: T('2026-08-30T10:00:00Z') },
    { seasonId: 'season-0', agentId: 'a2', optedIn: false, enteredAt: null },
  ]);
}

const rowsOf = async (query = '') => {
  const res = await request(app).get(`/api/data-room/actions${query}`);
  expect(res.status).toBe(200);
  return res.body as {
    generatedAt: string;
    kinds: Array<{ id: string; label: string; description: string }>;
    workspaces: Array<{ slug: string; name: string }>;
    rows: Array<{
      id: string;
      at: string;
      kind: string;
      workspace: { slug: string; name: string } | null;
      actor: { id: string; handle: string } | null;
      text: string;
      detail: Record<string, unknown>;
      href: string;
    }>;
    next: string | null;
  };
};

describe('the log answers anonymously and names its vocabulary', () => {
  it('answers a caller with no key and no session, with kinds and public floors', async () => {
    await seedFloors();
    const body = await rowsOf();
    expect(body.kinds.map(k => k.id)).toEqual(KINDS.map(k => k.id));
    for (const k of body.kinds) {
      expect(k.label).toBeTruthy();
      expect(k.description).toBeTruthy();
    }
    // The vocabulary lists public floors and only those.
    expect(body.workspaces).toEqual([{ slug: 'telarchy', name: 'Telarchy' }]);
    expect(body.next).toBeNull();
  });

  it('is open to every origin, like the rest of the data room', async () => {
    const { isPublicCorsPath } = await import('../lib/cors');
    expect(isPublicCorsPath('/api/data-room/actions')).toBe(true);
    expect(isPublicCorsPath('/api/data-room')).toBe(true);
  });
});

describe('every kind the doc names renders', () => {
  it('produces one sentence and one address per kind, newest first', async () => {
    await seedEverything();
    const { rows } = await rowsOf('?limit=200');
    const kinds = new Set(rows.map(r => r.kind));
    for (const k of KINDS) expect(kinds).toContain(k.id);
    for (const r of rows) {
      expect(r.text.length).toBeGreaterThan(3);
      expect(r.href.startsWith('/')).toBe(true);
      expect(r.id).toBeTruthy();
    }
    const ats = rows.map(r => new Date(r.at).getTime());
    expect(ats).toEqual([...ats].sort((a, b) => b - a));
  });

  it('a trade says the side, the shares, the credits and the call, and never the actor or the floor', async () => {
    await seedEverything();
    const { rows } = await rowsOf('?kinds=trade');
    expect(rows.map(r => r.id)).toEqual(['trade:t-sell', 'trade:t-buy']);
    const buy = rows[1];
    expect(buy.actor).toEqual({ id: 'a1', handle: 'vire' });
    expect(buy.workspace).toEqual({ slug: 'telarchy', name: 'Telarchy' });
    expect(buy.text).toBe('bought 10 higher shares on Active traders (2026-09) for 40 cr, call 4 to 5.2');
    expect(buy.text).not.toMatch(/vire|Telarchy/);
    expect(buy.detail).toMatchObject({
      side: 'buy',
      direction: 'higher',
      shares: 10,
      cost: 40,
      callBefore: 4,
      callAfter: 5.2,
      marketId: 'mkt1',
    });
    expect(buy.href).toBe('/telarchy#market=mkt1&trade=t-buy');
    const sell = rows[0];
    expect(sell.text).toBe('sold 4 higher shares on Active traders (2026-09) for 15 cr, call 5.2 to 4.9');
    expect(sell.detail).toMatchObject({ side: 'sell', shares: 4, cost: 15 });
  });

  it('a decision carries the status and the written reason; a removed row is not a decision', async () => {
    await seedEverything();
    const { rows } = await rowsOf('?kinds=decision');
    const byId = Object.fromEntries(rows.map(r => [r.id, r]));
    expect(Object.keys(byId).sort()).toEqual(['decision:p2', 'decision:p3', 'decision:p4', 'decision:p5']);
    expect(byId['decision:p2'].actor).toEqual({ id: 'a3', handle: 'a3' });
    expect(byId['decision:p2'].text).toMatch(/^approved "Paid job"/);
    expect(byId['decision:p3'].text).toBe('declined "Declined job" ($250): Too expensive');
    expect(byId['decision:p4'].text).toMatch(/lapsed/);
    expect(byId['decision:p4'].actor).toBeNull();
    expect(byId['decision:p5'].text).toMatch(/withdrawn/);
    expect(byId['decision:p2'].href).toBe('/telarchy/p/2');
    expect(byId['decision:p3'].detail).toMatchObject({ status: 'declined', reason: 'Too expensive', number: 3 });
  });

  it('proposals: the posting, the edit, the delivery; the spam row is absent everywhere', async () => {
    await seedEverything();
    const all = (await rowsOf('?limit=200')).rows;
    expect(all.some(r => r.text.includes('Spam row'))).toBe(false);
    const posted = all.filter(r => r.kind === 'proposal');
    expect(posted.map(r => r.id).sort()).toEqual([
      'proposal:p1',
      'proposal:p2',
      'proposal:p3',
      'proposal:p4',
      'proposal:p5',
      'proposal:pr1',
    ]);
    expect(posted.find(r => r.id === 'proposal:p1')?.text).toBe('proposed "Open job" for $50');
    expect(posted.find(r => r.id === 'proposal:pr1')?.text).toBe('edited the title of "Open job"');
    const delivered = all.filter(r => r.kind === 'delivery');
    expect(delivered).toHaveLength(1);
    expect(delivered[0].text).toBe('reported "Paid job" delivered: Shipped it');
    expect(delivered[0].actor).toEqual({ id: 'a1', handle: 'vire' });
  });

  it('comments are excerpts with an address on the thing commented on', async () => {
    await seedEverything();
    const { rows } = await rowsOf('?kinds=comment');
    expect(rows).toHaveLength(2);
    const onProposal = rows.find(r => r.id === 'comment:pm1')!;
    expect(onProposal.text.startsWith('on "Open job": Is this priced')).toBe(true);
    expect(onProposal.text.length).toBeLessThan(140);
    expect(onProposal.href).toBe('/telarchy/p/1#comment=pm1');
    const onBook = rows.find(r => r.id === 'comment:mm1')!;
    expect(onBook.text).toBe('on Active traders (2026-09): Cheap at 4.');
    expect(onBook.href).toBe('/telarchy#market=mkt1&comment=mm1');
  });

  it('an announcement and its edit are two rows', async () => {
    await seedEverything();
    const { rows } = await rowsOf('?kinds=announcement');
    expect(rows.map(r => r.id)).toEqual(['announcement:an1:edit', 'announcement:an1']);
    // The published row says what was announced THEN; the edit says what it
    // became.
    expect(rows[1].text).toBe('announced: We are live.');
    expect(rows[0].text).toBe('edited an announcement: We are live on the floor today.');
    expect(rows[1].actor).toEqual({ id: 'a3', handle: 'a3' });
    expect(rows[1].href).toBe('/telarchy/announcements');
  });

  it('a reading is a change in the value with its note; a metric is its creation or a definition edit', async () => {
    await seedEverything();
    const reading = (await rowsOf('?kinds=reading')).rows;
    expect(reading).toHaveLength(1);
    expect(reading[0].text).toBe('Active traders read 6, was 4 (hourly self-sync)');
    expect(reading[0].actor).toBeNull();
    expect(reading[0].detail).toMatchObject({ metric: 'Active traders', oldValue: 4, newValue: 6 });
    const metric = (await rowsOf('?kinds=metric')).rows;
    expect(metric.map(r => r.id)).toEqual(['metric:md1', 'metric:m1']);
    expect(metric[0].text).toBe('changed the description of Active traders');
    expect(metric[0].actor).toEqual({ id: 'a3', handle: 'a3' });
    expect(metric[1].text).toBe('added the metric Active traders');
  });

  it('a market opens, settles or is voided; a pair book is never its own row', async () => {
    await seedEverything();
    const { rows } = await rowsOf('?kinds=market');
    expect(rows.map(r => r.id)).toEqual([
      'market:mkt-void:settled',
      'market:mkt-done:settled',
      'market:mkt1:open',
      'market:mkt-void:open',
      'market:mkt-done:open',
    ]);
    expect(rows.find(r => r.id === 'market:mkt-done:settled')?.text).toBe('Active traders (2026-09) settled at 7');
    expect(rows.find(r => r.id === 'market:mkt-void:settled')?.text).toBe('Active traders (2026-09) was voided');
    expect(rows.find(r => r.id === 'market:mkt1:open')?.text).toBe('a book opened on Active traders (2026-09)');
    expect(rows.some(r => r.id.includes('mkt-pair'))).toBe(false);
  });

  it('liquidity is what a participant added, never the engine seeding a book', async () => {
    await seedEverything();
    const { rows } = await rowsOf('?kinds=liquidity');
    expect(rows.map(r => r.id)).toEqual(['liquidity:subsidy:p1:a3:2026-08-26T10:00', 'liquidity:lq-add']);
    expect(rows[1].text).toBe('put 250 cr of liquidity behind Active traders (2026-09)');
    expect(rows[1].actor?.handle).toBe('vire');
    // The three subsidy rows of one minute are one action: funding the proposal.
    expect(rows[0].text).toBe('funded "Open job" with 250 cr of liquidity');
    expect(rows[0].actor).toEqual({ id: 'a3', handle: 'a3' });
    expect(rows[0].href).toBe('/telarchy/p/1');
    expect(rows[0].detail).toMatchObject({ amount: 250, number: 1 });
    expect(rows.some(r => r.id.includes('anchor'))).toBe(false);
  });

  it('a join says which kind of participant, and a link says the provider', async () => {
    await seedEverything();
    const joins = (await rowsOf('?kinds=join')).rows;
    expect(joins.map(r => r.id)).toEqual(['join:a3', 'join:a2', 'join:a1']);
    expect(joins[2].text).toBe('joined as a person');
    expect(joins[1].text).toBe('joined as a bot run by vire');
    expect(joins[0].text).toBe('joined as an agent');
    expect(joins[2].actor).toEqual({ id: 'a1', handle: 'vire' });
    expect(joins[2].workspace).toBeNull();
    expect(joins[2].href).toBe('/participants/vire');
    const links = (await rowsOf('?kinds=link')).rows;
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe('linked a Manifold record');
    expect(links[0].detail).toMatchObject({ provider: 'manifold' });
    // The external handle is theirs to show on their profile, not the log's.
    expect(JSON.stringify(links[0])).not.toContain('vire-on-manifold');
  });

  it('a public floor opening is a row; the private one is not', async () => {
    await seedEverything();
    const { rows } = await rowsOf('?kinds=workspace');
    expect(rows.map(r => r.id)).toEqual(['workspace:ws-telarchy']);
    expect(rows[0].text).toBe('the floor Telarchy opened');
    expect(rows[0].href).toBe('/telarchy');
  });
});

describe('the kinds added when the log was found short (2026-09-10)', () => {
  it('an order is placed, and later filled, cancelled, expired or voided', async () => {
    await seedEverything();
    const { rows } = await rowsOf('?kinds=order');
    expect(rows.map(r => r.id)).toEqual(['order:lo-filled:filled', 'order:lo-filled', 'order:lo-open']);
    expect(rows[2].text).toBe('placed a limit order: up to 200 cr on lower at 3 on Active traders (2026-09)');
    expect(rows[1].text).toBe('placed a limit order: up to 50 cr on higher at 6 on Active traders (2026-09)');
    expect(rows[0].text).toBe('a limit order filled: 50 cr on higher at 6 on Active traders (2026-09)');
    expect(rows[0].actor).toEqual({ id: 'a1', handle: 'vire' });
    expect(rows[0].href).toBe('/telarchy#market=mkt1');
    expect(rows[0].detail).toMatchObject({ status: 'filled', filledCredits: 50, budgetCredits: 50, level: 6 });
  });

  it('a purchase is an amount and a floor, nobody named, completed only', async () => {
    await seedEverything();
    const { rows } = await rowsOf('?kinds=purchase');
    expect(rows.map(r => r.id)).toEqual(['purchase:buy-1']);
    expect(rows[0].at).toBe('2026-08-27T09:05:00.000Z');
    expect(rows[0].actor).toBeNull();
    expect(rows[0].text).toBe('5,000 credits were bought for $5');
    expect(rows[0].workspace?.slug).toBe('telarchy');
    expect(JSON.stringify(rows[0])).not.toContain('a1');
  });

  it('a grant says what the credits were for, by the earn table label or the key', async () => {
    await seedEverything();
    const { rows } = await rowsOf('?kinds=grant');
    expect(rows.map(r => r.id)).toEqual(['grant:claim-2', 'grant:claim-1']);
    expect(rows[1].text).toBe('was granted 1,000 cr: Link your Manifold record');
    expect(rows[1].actor?.handle).toBe('vire');
    expect(rows[0].text).toBe('was granted 50 cr: daily_trade');
    expect(rows[1].href).toBe('/participants/vire');
  });

  it('a transfer names both sides and never the memo', async () => {
    await seedEverything();
    const { rows } = await rowsOf('?kinds=transfer');
    expect(rows.map(r => r.id)).toEqual(['transfer:tr-back', 'transfer:tr-1']);
    expect(rows[1].actor?.handle).toBe('vire');
    expect(rows[1].text).toBe('sent 250 cr to a3');
    expect(rows[1].detail).toMatchObject({ credits: 250, toId: 'a3', toHandle: 'a3' });
    expect(rows[0].actor?.handle).toBe('a3');
    expect(rows[0].text).toBe('sent 100 cr to vire');
    expect(JSON.stringify(rows)).not.toMatch(/private note|reversal/);
  });

  it('a season entry is a row; an opt-out that never entered is not', async () => {
    await seedEverything();
    const { rows } = await rowsOf('?kinds=season');
    expect(rows.map(r => r.id)).toEqual(['season:season-0:a1']);
    expect(rows[0].text).toBe('entered Season 0');
    expect(rows[0].href).toBe('/season');
  });
});

describe('a row outlives the thing it points at', () => {
  it('a trade, an order, a comment and a liquidity row on a book since removed are still rows', async () => {
    await seedEverything();
    await db.delete(markets).where(eq(markets.id, 'mkt1'));
    const { rows } = await rowsOf('?limit=200');
    const trade = rows.find(r => r.id === 'trade:t-buy');
    expect(trade).toBeTruthy();
    expect(trade!.text).toBe('bought 10 higher shares on a book since removed for 40 cr, call 4 to 5.2');
    expect(rows.find(r => r.id === 'liquidity:lq-add')?.text).toBe(
      'put 250 cr of liquidity behind a book since removed',
    );
    expect(rows.find(r => r.id === 'order:lo-open')?.text).toMatch(/on a book since removed$/);
    expect(rows.find(r => r.id === 'comment:mm1')?.text).toBe('on a book since removed: Cheap at 4.');
  });

  it('a metric edit whose metric is gone is still a row', async () => {
    await seedEverything();
    await db.delete(metrics).where(eq(metrics.id, 'm1'));
    const { rows } = await rowsOf('?kinds=metric');
    expect(rows.find(r => r.id === 'metric:md1')?.text).toBe('changed the description of a metric since removed');
  });
});

describe('nothing private leaks', () => {
  it('a private floor contributes nothing under any kind', async () => {
    await seedEverything();
    const { rows, workspaces: ws } = await rowsOf('?limit=200');
    const blob = JSON.stringify(rows);
    expect(blob).not.toContain('Secret');
    expect(blob).not.toContain('secret');
    expect(blob).not.toContain('private');
    expect(blob).not.toContain('t-private');
    expect(ws.map(w => w.slug)).toEqual(['telarchy']);
  });

  it('no email, no external handle, no payout detail anywhere in the response', async () => {
    await seedEverything();
    const res = await request(app).get('/api/data-room/actions?limit=200');
    const blob = JSON.stringify(res.body);
    expect(blob).not.toContain('vire@example.com');
    expect(blob).not.toContain('example.com');
    expect(blob).not.toMatch(/"ip"|"country"|"referer"|payout/);
    expect(blob).not.toMatch(/private note between them/);
  });

  it('a redemption is bookkeeping and is never a row', async () => {
    await seedEverything();
    const { rows } = await rowsOf('?limit=200');
    expect(rows.some(r => r.id.includes('t-redeem'))).toBe(false);
  });
});

describe('filters', () => {
  it('kinds narrows to the named kinds and an unknown kind is a 400 naming the parameter', async () => {
    await seedEverything();
    const { rows } = await rowsOf('?kinds=trade,join');
    expect(new Set(rows.map(r => r.kind))).toEqual(new Set(['trade', 'join']));
    const bad = await request(app).get('/api/data-room/actions?kinds=trade,nonesuch');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/kinds/);
    expect(bad.body.error).toMatch(/nonesuch/);
  });

  it('workspace narrows to one public floor by slug; a private or unknown slug is a 400', async () => {
    await seedEverything();
    const { rows } = await rowsOf('?workspace=telarchy&limit=200');
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) expect(r.workspace?.slug).toBe('telarchy');
    for (const slug of ['secret', 'nonesuch']) {
      const bad = await request(app).get(`/api/data-room/actions?workspace=${slug}`);
      expect(bad.status).toBe(400);
      expect(bad.body.error).toMatch(/workspace/);
    }
  });

  it('participant matches the handle in any case, or the id; unknown is a 400', async () => {
    await seedEverything();
    const byHandle = (await rowsOf('?participant=VIRE&limit=200')).rows;
    expect(byHandle.length).toBeGreaterThan(3);
    for (const r of byHandle) expect(r.actor?.id).toBe('a1');
    const byId = (await rowsOf('?participant=a1&limit=200')).rows;
    expect(byId.map(r => r.id)).toEqual(byHandle.map(r => r.id));
    const bad = await request(app).get('/api/data-room/actions?participant=nobody');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/participant/);
  });

  it('after and before are strict bounds on the instant', async () => {
    await seedEverything();
    const { rows } = await rowsOf('?after=2026-08-10T09:00:00Z&before=2026-08-11T12:00:00Z');
    expect(rows.map(r => r.id)).toEqual(['trade:t-sell']);
    const bad = await request(app).get('/api/data-room/actions?after=yesterday');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/after/);
  });
});

describe('paging', () => {
  async function seedManyTrades(n: number) {
    await seedFloors();
    // Two rows share every instant, which is exactly the case a cursor on the
    // instant alone gets wrong.
    await db.insert(trades).values(
      Array.from({ length: n }, (_, i) => ({
        id: `t${String(i).padStart(4, '0')}`,
        workspaceId: PUB,
        agentId: 'a1',
        marketId: 'mkt1',
        direction: 'higher',
        shares: 1,
        cost: 1,
        kind: 'trade',
        createdAt: new Date(Date.UTC(2026, 7, 1, 0, Math.floor(i / 2))),
      })),
    );
  }

  it('defaults to 50 rows and caps at 200', async () => {
    await seedManyTrades(260);
    expect((await rowsOf('?kinds=trade')).rows).toHaveLength(50);
    expect((await rowsOf('?kinds=trade&limit=500')).rows).toHaveLength(200);
    expect((await rowsOf('?kinds=trade&limit=7')).rows).toHaveLength(7);
    for (const bad of ['0', '-1', 'ten']) {
      const res = await request(app).get(`/api/data-room/actions?limit=${bad}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/limit/);
    }
  });

  it('walks the whole log through next without repeating or skipping a row, then ends on null', async () => {
    await seedManyTrades(23);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const body = await rowsOf(`?kinds=trade&limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      seen.push(...body.rows.map(r => r.id));
      cursor = body.next;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    expect(seen).toHaveLength(23);
    expect(new Set(seen).size).toBe(23);
    // And the last page is the oldest rows.
    expect(seen[seen.length - 1]).toBe('trade:t0000');
  });

  it('next is null when the page was not full', async () => {
    await seedManyTrades(3);
    const body = await rowsOf('?kinds=trade&limit=5');
    expect(body.rows).toHaveLength(3);
    expect(body.next).toBeNull();
  });

  it('a garbage cursor is a 400', async () => {
    await seedFloors();
    const res = await request(app).get('/api/data-room/actions?cursor=zzz');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cursor/);
  });
});

describe('the room as a document', () => {
  it('GET /api/data-room is schema 2: one prose section and the first page of the log', async () => {
    await seedEverything();
    const res = await request(app).get('/api/data-room');
    expect(res.status).toBe(200);
    expect(res.body.schema).toBe(2);
    expect(res.body.doc.sections.map((s: { id: string }) => s.id)).toEqual(['actions']);
    expect(res.body.doc.sections[0].markdown).toMatch(/action/i);
    expect(res.body.doc.sections[0].markdown).not.toMatch(/\d{2,}/);
    expect(res.body.actions.rows.length).toBeGreaterThan(5);
    expect(res.body.actions.kinds.map((k: { id: string }) => k.id)).toEqual(KINDS.map(k => k.id));
    expect(res.body).not.toHaveProperty('evidence');
  });

  it('Otto reads the log as lines of text, with the same filters', async () => {
    await seedEverything();
    const tool = actionsTool();
    expect(tool.spec.function.name).toBe('read_data_room');
    const all = await tool.run({});
    expect(all).toMatch(/kinds:/i);
    expect(all).toContain('vire');
    expect(all).toContain('bought 10 higher shares');
    const only = await tool.run({ kinds: 'decision' });
    expect(only).toContain('declined "Declined job"');
    expect(only).not.toContain('bought 10');
    const bad = await tool.run({ kinds: 'nonesuch' });
    expect(bad).toMatch(/nonesuch/);
  });

  it("the platform's own floor hands an agent the latest page as its Data room document", async () => {
    await seedEverything();
    process.env.SELF_SYNC_WORKSPACE_ID = PUB;
    await db
      .insert(permissionGroups)
      .values([{ id: 'pg', workspaceId: PUB, name: 'Public', type: 'public', capabilities: ['read'] }]);
    const res = await request(app).get('/api/marketplace/telarchy/context');
    expect(res.status).toBe(200);
    const doc = res.body.documents.find((d: { name: string }) => d.name === 'Data room');
    expect(doc).toBeTruthy();
    expect(doc.content).toContain('bought 10 higher shares');
    expect(doc.content).toContain('/api/data-room/actions');
  });

  it('renders a row as one line: instant, kind, actor, floor, sentence', async () => {
    await seedEverything();
    const page = await buildActions({ kinds: ['trade'], limit: 1 });
    const text = renderActionsText(page);
    expect(text).toContain('2026-08-10T09:05:00');
    expect(text).toMatch(/trade\s+vire\s+telarchy\s+sold 4 higher shares/);
  });
});
