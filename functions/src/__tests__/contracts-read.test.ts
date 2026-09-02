/**
 * GET /api/marketplace/:idOrSlug/contracts: the one read that answers "which
 * proposal is worth approving".
 *
 * It exists because of a measurement, not a preference. On 2026-08-31 Otto was
 * told the floor's public payload answered that question in one call. It does
 * carry the answer, inside 86KB, and an assistant's tool result is capped at
 * 24,000 characters, so what he actually got was the list cut in half and an
 * instruction to ask for something narrower. He then opened five proposals one
 * at a time and the answer cost twice what it should have. A payload that has
 * to be truncated is not an answer.
 *
 * The load-bearing test here is THE WHOLE FLOOR FITS IN ONE TOOL RESULT.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, permissionGroups, proposalMessages, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
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

/** The cap on one tool result in services/otto-tools.ts. The number this
 *  endpoint exists to stay under, so it is named rather than inlined. */
const TOOL_RESULT_CAP = 24_000;

const WS = 'ws-proposals';
const LIVE = '2030-06';
const PAST = '2020-01';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await seed();
});

async function seed(opts: { publicCaps?: string[]; visibility?: string } = {}) {
  const { publicCaps = ['read', 'trade'], visibility = 'public' } = opts;
  await db.insert(agents).values({ id: 'owner', apiKeyHash: 'h-owner', balance: 0, nickname: 'owner' });
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
  await db.insert(metrics).values({
    id: 'metric-1',
    workspaceId: WS,
    name: 'Weekly active verified traders',
    description: 'Distinct verified participants who traded in the trailing 7 days.',
    value: 4,
    marketRangeMax: 50,
  });
}

async function proposal(
  id: string,
  status: string,
  horizons: Array<{ date: string; approvedShares: number; voided?: boolean }>,
) {
  await db.insert(proposals).values({
    id,
    workspaceId: WS,
    proposedBy: 'owner',
    title: `$100: ${id}`,
    description:
      'A pitch of the length a real proposal carries. Several sentences of reasoning about why the work matters, what done looks like, and who is doing it, because that is what the full brief holds and this read does not.',
    askUsd: 100,
    status,
  });
  await db.insert(proposalMessages).values({
    id: `msg-${id}`,
    workspaceId: WS,
    proposalId: id,
    from: 'owner',
    content: 'A conversation that belongs on the proposal page.',
  });
  for (const h of horizons) {
    for (const [branch, shares] of [
      ['approved', h.approvedShares],
      ['declined', 0],
    ] as const) {
      await db.insert(markets).values({
        id: `mkt-${id}-${h.date}-${branch}`,
        workspaceId: WS,
        metricId: 'metric-1',
        metricName: 'Weekly active verified traders',
        targetDate: h.date,
        rangeMin: 0,
        rangeMax: 50,
        shares: [0, shares],
        liquidity: 100,
        pool: initialPool(100),
        active: true,
        resolved: false,
        voided: h.voided ?? false,
        proposalId: id,
        branch,
      });
    }
  }
}

const get = (q = '') => request(app).get(`/api/marketplace/${WS}/contracts${q}`);

describe('THE WHOLE FLOOR FITS IN ONE TOOL RESULT', () => {
  test('a floor the size of the real one lands under the assistant tool cap', async () => {
    // Twenty proposals, three live horizons each plus retired ones, which is
    // bigger than the floor that broke this.
    for (let i = 0; i < 20; i++) {
      await proposal(`c${i}`, i % 3 === 0 ? 'pending' : 'approved', [
        { date: LIVE, approvedShares: 10 + i },
        { date: '2031-01', approvedShares: 5 },
        { date: '2032-01', approvedShares: 8 },
        { date: PAST, approvedShares: 40 },
        { date: '2019-01', approvedShares: 40, voided: true },
      ]);
    }
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.contracts).toHaveLength(20);
    expect(JSON.stringify(res.body).length).toBeLessThan(TOOL_RESULT_CAP);
  });

  test('a floor far bigger than any real one still fits, by dropping the pitches', async () => {
    // The invariant is that this read NEVER has to be truncated. Descriptions
    // are the elastic part, so they are what goes; the prices never do,
    // because they are the answer.
    for (let i = 0; i < 90; i++) {
      await proposal(`c${i}`, 'pending', [
        { date: LIVE, approvedShares: 10 },
        { date: '2031-01', approvedShares: 5 },
        { date: '2032-01', approvedShares: 7 },
      ]);
    }
    const res = await get();
    expect(res.body.descriptionsOmitted).toBe(true);
    expect(res.body.contracts[0].description).toBeUndefined();
    expect(res.body.contracts[0].impact.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body).length).toBeLessThan(TOOL_RESULT_CAP);
  });

  test('a floor with more proposals than one read holds SAYS so, never silently', async () => {
    // The brief carries the newest 25 proposals. A reader deciding what to
    // approve has to know when there are older ones it is not being shown,
    // because a silent cut is the failure this whole endpoint exists to end.
    for (let i = 0; i < 30; i++) {
      await proposal(`c${i}`, 'pending', [{ date: LIVE, approvedShares: 10 }]);
    }
    const res = await get();
    expect(res.body.contracts).toHaveLength(25);
    expect(res.body.contractsTotal).toBe(30);
    expect(res.body.olderContractsOmitted).toBe(true);
  });

  test('a floor that fits says nothing about omission', async () => {
    await proposal('c1', 'pending', [{ date: LIVE, approvedShares: 10 }]);
    const res = await get();
    expect(res.body.contractsTotal).toBe(1);
    expect(res.body.olderContractsOmitted).toBeUndefined();
    expect(res.body.descriptionsOmitted).toBeUndefined();
  });
});

describe('it carries what pricing a decision needs, and nothing else', () => {
  test('the gist of the pitch, never the conversation or the market plumbing', async () => {
    await proposal('c1', 'pending', [{ date: LIVE, approvedShares: 20 }]);
    const res = await get();
    // Without this the absence assertions below pass on a 404.
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    // Enough of the pitch to know what the work IS, since a reader who cannot
    // tell that from the title goes and opens the proposal, which is the round
    // trip this endpoint exists to remove.
    expect(res.body.contracts[0].description).toContain('A pitch of the length');
    expect(body).not.toContain('A conversation that belongs');
    expect(body).not.toMatch(/approvedMarketId|approvedPool|approvedVolume|probability/);
  });

  test('a long pitch is cut and says it was cut', async () => {
    await proposal('c1', 'pending', [{ date: LIVE, approvedShares: 20 }]);
    await db
      .update(proposals)
      .set({ description: 'x'.repeat(3000) })
      .where(eq(proposals.id, 'c1'));
    const [c] = (await get()).body.contracts;
    expect(c.description.length).toBeLessThanOrEqual(320);
    expect(c.descriptionTruncated).toBe(true);
  });

  test('each horizon says what it is a price of', async () => {
    await proposal('c1', 'pending', [{ date: LIVE, approvedShares: 20 }]);
    const [c] = (await get()).body.contracts;
    expect(c).toMatchObject({ id: 'c1', askUsd: 100, status: 'pending', decisionOpen: true });
    const [h] = c.impact;
    expect(h.metricName).toBe('Weekly active verified traders');
    expect(h.targetDate).toBe(LIVE);
    expect(h.resolvesOn).toBe('2030-07-01T00:00:00Z');
    expect(typeof h.delta).toBe('number');
    expect(h).toHaveProperty('baseline');
    expect(h).toHaveProperty('approvedTrades');
    expect(h).toHaveProperty('declinedTrades');
  });
});

describe('live horizons only, because a settled one cannot be influenced', () => {
  test('a settled horizon is left out by default', async () => {
    await proposal('c1', 'approved', [
      { date: LIVE, approvedShares: 20 },
      { date: PAST, approvedShares: 40 },
    ]);
    const [c] = (await get()).body.contracts;
    expect(c.impact.map((h: any) => h.targetDate)).toEqual([LIVE]);
  });

  test('?horizons=all adds them back for anyone reading the record', async () => {
    await proposal('c1', 'approved', [
      { date: LIVE, approvedShares: 20 },
      { date: PAST, approvedShares: 40 },
    ]);
    const [c] = (await get('?horizons=all')).body.contracts;
    expect(c.impact.map((h: any) => h.targetDate)).toEqual([LIVE, PAST]);
  });

  test('a proposal whose every horizon has settled still appears, with an empty impact', async () => {
    await proposal('c1', 'approved', [{ date: PAST, approvedShares: 40 }]);
    const [c] = (await get()).body.contracts;
    expect(c.impact).toEqual([]);
  });
});

describe('the same rules the rest of the floor holds', () => {
  test('a voided pair is dropped on a pending proposal and kept on a decided one', async () => {
    await proposal('pend', 'pending', [{ date: LIVE, approvedShares: 20, voided: true }]);
    await proposal('done', 'approved', [{ date: LIVE, approvedShares: 20, voided: true }]);
    const byId = new Map((await get()).body.contracts.map((c: any) => [c.id, c]));
    expect((byId.get('pend') as any).impact).toEqual([]);
    expect((byId.get('done') as any).impact).toHaveLength(1);
  });

  test('proposals still open for a decision come first', async () => {
    await proposal('done', 'approved', [{ date: LIVE, approvedShares: 40 }]);
    await proposal('pend', 'pending', [{ date: LIVE, approvedShares: 10 }]);
    const ids = (await get()).body.contracts.map((c: any) => c.id);
    expect(ids).toEqual(['pend', 'done']);
  });

  test('a private workspace is refused, and so is a public one nobody may read', async () => {
    await truncateAll();
    await seed({ visibility: 'private' });
    expect((await get()).status).toBe(403);
    await truncateAll();
    await seed({ publicCaps: [] });
    expect((await get()).status).toBe(403);
  });
});
