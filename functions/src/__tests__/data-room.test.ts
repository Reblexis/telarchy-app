/**
 * The data room's contract (docs/data-room.md).
 *
 * Three things are pinned here, each of which has a way of breaking silently
 * on a public page:
 *
 * 1. The prose names only blocks the feed carries, and the feed carries every
 *    block the prose names. A renamed block would otherwise delete a number
 *    from the document and nobody would see an error.
 * 2. The page answers anonymously. Its whole claim is that a visitor can fetch
 *    the URL the page fetches; an auth gate would make the claim false.
 * 3. Traffic counts what the owner's cockpit counts. A public number that
 *    flatters, next to a private one that does not, is worse than no public
 *    number at all, because both look official.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = null;
    next();
  },
  optionalAuthMiddleware: (req: any, _res: any, next: any) => {
    req.auth = req.auth ?? null;
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import { DATA_ROOM_MARKDOWN, KNOWN_BLOCKS } from '../content/data-room';
import {
  agents,
  earnClaims,
  markets,
  metricLogs,
  metrics,
  pageVisits,
  proposals,
  recordLinks,
  systemConfig,
  workspaces,
} from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { toUnits } from '../lib/validation';
import { dataRoomRouter } from '../routes/data-room';
import {
  buildDataRoomFeed,
  clearDataRoomCache,
  parseDataRoomContent,
  renderDataRoomIndex,
  renderDataRoomSection,
} from '../services/data-room';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/data-room', dataRoomRouter);
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);
beforeEach(async () => {
  await truncateAll();
  clearDataRoomCache();
});

const WS = 'ws-telarchy';

async function seed() {
  await db
    .insert(workspaces)
    .values([{ id: WS, name: 'Telarchy', slug: 'telarchy', createdBy: 'seed', visibility: 'public' }]);
  await db.insert(agents).values([{ id: 'a1', apiKeyHash: 'h1', balance: toUnits(100) }]);
  await db
    .insert(metrics)
    .values([{ id: 'm1', workspaceId: WS, name: 'Active traders', value: 4, formula: '0', marketRangeMax: 50 }]);
  await db.insert(markets).values([
    {
      id: 'mkt1',
      workspaceId: WS,
      metricId: 'm1',
      metricName: 'Active traders',
      targetDate: '2026-09',
      rangeMin: 0,
      rangeMax: 50,
      shares: [0, 0] as [number, number],
      liquidity: 100,
      pool: initialPool(100),
      active: true,
      resolved: false,
      voided: false,
    },
  ]);
  await db.insert(metricLogs).values([
    {
      id: 'l1',
      workspaceId: WS,
      metricId: 'm1',
      metricName: 'Active traders',
      value: 2,
      timestamp: new Date('2026-08-01'),
    },
    {
      id: 'l2',
      workspaceId: WS,
      metricId: 'm1',
      metricName: 'Active traders',
      value: 4,
      timestamp: new Date('2026-08-10'),
    },
  ]);
  await db.insert(proposals).values([
    { id: 'p1', workspaceId: WS, proposedBy: 'a1', title: 'Paid job', status: 'approved', askUsd: 100 },
    { id: 'p2', workspaceId: WS, proposedBy: 'a1', title: 'Declined job', status: 'declined', askUsd: 250 },
    { id: 'p3', workspaceId: WS, proposedBy: 'a1', title: 'Open job', status: 'pending', askUsd: 50 },
  ]);
}

describe('the document and the feed cannot disagree', () => {
  it('names only blocks the page knows how to render', () => {
    // parseDataRoomContent throws on an unknown name, and the route module
    // parses at import time, so this failing means the deploy would fail too.
    const sections = parseDataRoomContent(DATA_ROOM_MARKDOWN);
    expect(sections.length).toBeGreaterThan(3);
    for (const s of sections) {
      for (const b of s.blocks) expect(KNOWN_BLOCKS).toContain(b);
    }
  });

  it('refuses an unknown block rather than rendering a hole', () => {
    expect(() => parseDataRoomContent('## Bad\n\nprose\n\nblock:nonesuch\n')).toThrow(/unknown block "nonesuch"/);
  });

  it('strips the directives out of the prose it ships', () => {
    const [section] = parseDataRoomContent('## Overview\n\nA sentence.\n\nblock:pulse\n');
    expect(section.markdown).toBe('A sentence.');
    expect(section.blocks).toEqual(['pulse']);
  });

  it('carries every block the prose names', async () => {
    await seed();
    const res = await request(app).get('/api/data-room');
    expect(res.status).toBe(200);
    const named = new Set(res.body.doc.sections.flatMap((s: { blocks: string[] }) => s.blocks));
    for (const block of named) {
      expect(res.body.evidence).toHaveProperty(block as string);
    }
    expect(named.size).toBeGreaterThan(0);
  });
});

describe('what the feed publishes', () => {
  it('answers a caller with no key and no session', async () => {
    await seed();
    const res = await request(app).get('/api/data-room');
    expect(res.status).toBe(200);
    expect(res.body.doc.sections[0].title).toBeTruthy();
  });

  it('publishes the funnel that ends in the floor metric', async () => {
    await seed();
    const now = new Date();
    await db.insert(pageVisits).values([
      { id: 'f1', ts: now, path: '/', ip: '1.1.1.1', userAgent: 'Mozilla/5.0' },
      { id: 'f2', ts: now, path: '/', ip: '2.2.2.2', userAgent: 'Mozilla/5.0' },
    ]);
    const { body } = await request(app).get('/api/data-room');
    const f = body.evidence.funnel;
    // Four steps, in order, each a filter on the one above it.
    expect(f.steps.map((s: { id: string }) => s.id)).toEqual(['loads', 'accounts', 'verified', 'weeklyActive']);
    // Every count is the one the rest of the feed already publishes; a funnel
    // that recomputes its own totals is a second pipeline that can disagree.
    const byId = Object.fromEntries(f.steps.map((s: { id: string; n: number }) => [s.id, s.n]));
    expect(byId.loads).toBe(body.evidence.traffic.totalVisits);
    expect(byId.accounts).toBe(body.evidence.traction.accounts);
    expect(byId.verified).toBe(body.evidence.traction.verifiedParticipants);
    expect(byId.weeklyActive).toBe(body.evidence.pulse.weeklyActiveVerifiedTraders);
    // The share is of the step above, and the first step has none to be a
    // share of, so it refuses rather than reading 100%.
    expect(f.steps[0].shareOfAbove).toBeNull();
    expect(f.steps[1].shareOfAbove).toBeCloseTo(byId.accounts / byId.loads, 6);
  });

  it('counts a verified participant as one we PAID for a record, nothing else', async () => {
    await seed();
    await db.insert(agents).values([
      { id: 'a2', apiKeyHash: 'h2', balance: toUnits(100) },
      { id: 'badged-only', apiKeyHash: 'h3', balance: toUnits(100) },
    ]);
    await db.insert(earnClaims).values(
      ['a1', 'a2'].map(id => ({
        id: `claim-${id}`,
        agentId: id,
        key: 'manifold_link' as const,
        refId: `x-${id}`,
        credits: 5000,
      })),
    );
    // A free badge, which since 2026-09-02 costs a bio edit, is not
    // evidence and must not appear on the data room as if it were.
    await db
      .insert(recordLinks)
      .values([{ agentId: 'badged-only', provider: 'manifold', externalId: 'x-free', handle: 'four_days_old' }]);
    // The shape the route deleted on 2026-09-01 wrote; migration 0100 removed
    // every such row, and a count that still read it published zero.
    await db.insert(systemConfig).values([{ key: 'manifold-claimed:agent:ghost', value: { username: 'ghost' } }]);
    const { body } = await request(app).get('/api/data-room');
    expect(body.evidence.traction.verifiedParticipants).toBe(2);
    const byId = Object.fromEntries(body.evidence.funnel.steps.map((s: { id: string; n: number }) => [s.id, s.n]));
    expect(byId.verified).toBe(2);
  });

  it('refuses a share rather than dividing by zero', async () => {
    // No seed: an empty database has no loads and no accounts, and 0/0 must
    // come back as not published rather than as NaN on a public page.
    const { body } = await request(app).get('/api/data-room');
    for (const step of body.evidence.funnel.steps) {
      expect(step.shareOfAbove === null || Number.isFinite(step.shareOfAbove)).toBe(true);
    }
  });

  it('leaves removed entries out, so the contract rows add up', async () => {
    await seed();
    // Removed is the admin taking an entry off the board because it should
    // never have been there (spam, a duplicate, a test row), not a decision.
    await db
      .insert(proposals)
      .values([{ id: 'p4', workspaceId: WS, proposedBy: 'a1', title: 'Spam', status: 'removed', askUsd: 999 }]);
    const { body } = await request(app).get('/api/data-room');
    const c = body.evidence.contracts;
    expect(c.approved + c.declined + c.pending + c.withdrawn).toBe(c.proposed);
    expect(c.proposed).toBe(3);
  });

  it('counts only approved asks as money committed', async () => {
    await seed();
    const { body } = await request(app).get('/api/data-room');
    expect(body.evidence.contracts).toMatchObject({
      proposed: 3,
      approved: 1,
      declined: 1,
      pending: 1,
    });
    // 100 from the approved job. The declined 250 and the pending 50 are not
    // commitments, and publishing them as such would overstate the spend.
    expect(body.evidence.contracts.approvedUsd).toBe(100);
  });
});

describe('nothing restates what the market currently forecasts', () => {
  it('publishes no market block, no call and no settle date', async () => {
    await seed();
    const { body } = await request(app).get('/api/data-room');
    expect(body.evidence).not.toHaveProperty('market');
    const flat = JSON.stringify(body.evidence);
    expect(flat).not.toMatch(/consensus/i);
    expect(flat).not.toMatch(/resolvesOn/i);
  });

  it('never names a price or a call in the prose', () => {
    const prose = DATA_ROOM_MARKDOWN.toLowerCase();
    for (const word of ["the market's call", 'consensus', 'settles on', 'forecasts that']) {
      expect(prose).not.toContain(word);
    }
  });
});

describe('traffic counts what the cockpit counts', () => {
  it('drops bots and scanner probes, and keeps the day in the rollup', async () => {
    await seed();
    const now = new Date();
    await db.insert(pageVisits).values([
      { id: 'v1', ts: now, path: '/telarchy', ip: '1.1.1.1', userAgent: 'Mozilla/5.0' },
      { id: 'v2', ts: now, path: '/telarchy', ip: '1.1.1.1', userAgent: 'Mozilla/5.0' },
      { id: 'v3', ts: now, path: '/', ip: '2.2.2.2', userAgent: 'Mozilla/5.0' },
      // Neither of these is a person showing up.
      { id: 'v4', ts: now, path: '/', ip: '3.3.3.3', userAgent: 'Googlebot/2.1' },
      { id: 'v5', ts: now, path: '/wp-admin', ip: '4.4.4.4', userAgent: 'Mozilla/5.0' },
    ]);

    const { body } = await request(app).get('/api/data-room');
    expect(body.evidence.traffic.visits24h).toBe(3);
    expect(body.evidence.traffic.uniques24h).toBe(2);
    // The rollup is what survives the 30-day purge, so it has to hold the
    // same count rather than being recomputed from rows that will be gone.
    expect(body.evidence.traffic.byDay).toHaveLength(1);
    expect(body.evidence.traffic.byDay[0].visits).toBe(3);
    expect(body.evidence.traffic.keptSince).toBe(body.evidence.traffic.byDay[0].day);
  });

  it('keeps a day after its visit rows are purged', async () => {
    await seed();
    const old = new Date(Date.now() - 40 * 24 * 3600 * 1000);
    await db.insert(pageVisits).values([{ id: 'old1', ts: old, path: '/', ip: '9.9.9.9', userAgent: 'Mozilla/5.0' }]);
    await request(app).get('/api/data-room');

    // The cockpit purges on read; the published history must not shrink with it.
    await db.delete(pageVisits);
    clearDataRoomCache();
    const { body } = await request(app).get('/api/data-room');
    expect(body.evidence.traffic.byDay).toHaveLength(1);
    expect(body.evidence.traffic.byDay[0].visits).toBe(1);
    expect(body.evidence.traffic.totalVisits).toBe(1);
  });
});

/**
 * Otto reads the data room himself rather than carrying it in every brief
 * (owner direction 2026-08-20). What matters here is that what he reads is
 * the same object the page renders, in a shape he can quote.
 */
describe('what Otto browses', () => {
  it('lists the sections, then reads one with its figures attached', async () => {
    await seed();
    const feed = await buildDataRoomFeed();

    const index = renderDataRoomIndex(feed);
    for (const s of feed.doc.sections) expect(index).toContain(s.id);
    expect(index).toContain('read_data_room');

    const section = renderDataRoomSection(feed, 'who-is-here');
    // The prose exactly as published, and the live figures under it.
    expect(section).toContain('runs on itself');
    expect(section).toContain('page loads');
    expect(section).toContain('verified on Manifold');
  });

  it('says which sections exist rather than inventing the one asked for', async () => {
    await seed();
    const feed = await buildDataRoomFeed();
    const out = renderDataRoomSection(feed, 'revenue');
    expect(out).toMatch(/No section "revenue"/);
    expect(out).toContain('traffic');
  });

  it('renders a figure it does not have as not published, never as zero', async () => {
    await seed();
    const feed = await buildDataRoomFeed();
    // The traffic rollup is empty on a fresh database: keptSince is null, and
    // "since 0" would read as a measurement rather than as an absence.
    expect(renderDataRoomSection(feed, 'traffic')).toContain('not published');
  });
});
