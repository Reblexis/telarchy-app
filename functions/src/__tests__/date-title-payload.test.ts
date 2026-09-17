/**
 * A date's title reaches the column and comes back on the floor payload,
 * on the book of the date it names (docs/guides/time-preference.md, "A title
 * for a date"; docs/ui-conventions.md, "The question line").
 *
 * The rule a silent failure would break: a title validated and then dropped
 * looks exactly like a working one from the outside, and a title that lands
 * on the wrong book renames the wrong question.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../middleware/roles', () => ({
  requireCapability: () => (_req: any, _res: any, next: any) => next(),
  requireIdentity: (_req: any, _res: any, next: any) => next(),
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics } from '../db/schema';
import { toAbsoluteDate } from '../lib/date-utils';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { marketplaceRouter } from '../routes/marketplace';
import { metricsRouter } from '../routes/metrics';
import type { TimePreference } from '../types';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-date-title';
const OWNER = 'agent-date-title-owner';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).auth = {
    agentId: OWNER,
    uid: null,
    workspaceId: WS,
    capabilities: new Set(['read', 'trade', 'manage']),
    isMasterKey: true,
  };
  next();
});
app.use('/api/metrics', metricsRouter);
app.use('/api/marketplace', marketplaceRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  res.status(err instanceof AppError ? err.status : 500).json({ error: err.message });
});

const WEEK = toAbsoluteDate('+0w');

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await seed();
});

async function seed() {
  await db.insert(agents).values([{ id: OWNER, apiKeyHash: 'h-date-title-owner', balance: toUnits(100000) }]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Snake',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: 'len',
    workspaceId: WS,
    name: 'Reached length',
    description: 'The length the current attempt has reached.',
    value: 3,
    formula: '',
    order: 0,
    marketRangeMax: 64,
    timePreference: {
      enabled: false,
      halfLife: 1,
      customHorizons: ['until-settled', '+0w'],
      horizonTitles: { 'until-settled': 'this attempt' },
    },
  });
  const book = (id: string, targetDate: string) => ({
    id,
    workspaceId: WS,
    metricId: 'len',
    metricName: 'Reached length',
    targetDate,
    resolved: false,
    active: true,
    rangeMin: 0,
    rangeMax: 64,
    shares: [0, 0] as [number, number],
    liquidity: 200,
    pool: 1200,
  });
  await db.insert(markets).values([book('mkt-open', 'until-settled'), book('mkt-week', WEEK)]);
}

const floorMarket = async (id: string) => {
  const r = await request(app).get(`/api/marketplace/${WS}`);
  expect(r.status).toBe(200);
  return (r.body.markets as Array<Record<string, unknown>>).find(m => m.marketId === id);
};
const storedTp = async () =>
  (
    await db
      .select()
      .from(metrics)
      .where(and(eq(metrics.id, 'len'), eq(metrics.workspaceId, WS)))
  )[0].timePreference as TimePreference;

describe("A DATE'S TITLE REACHES THE BOOK OF THE DATE IT NAMES", () => {
  test('the titled date carries its title on the floor payload; the untitled one says null', async () => {
    expect((await floorMarket('mkt-open'))?.dateTitle).toBe('this attempt');
    expect((await floorMarket('mkt-week'))?.dateTitle).toBeNull();
  });

  test('a rolling entry titles the book it resolves to right now', async () => {
    const put = await request(app)
      .put('/api/metrics/len')
      .send({
        timePreference: {
          enabled: false,
          halfLife: 1,
          customHorizons: ['until-settled', '+0w'],
          horizonTitles: { 'until-settled': 'this attempt', '+0w': 'this week of the sprint' },
        },
      });
    expect(put.status).toBe(200);
    expect((await storedTp()).horizonTitles).toEqual({
      'until-settled': 'this attempt',
      '+0w': 'this week of the sprint',
    });
    expect((await floorMarket('mkt-week'))?.dateTitle).toBe('this week of the sprint');
  });

  test('the book of an owner-settled date says so on the payload, far instant and all', async () => {
    const m = await floorMarket('mkt-open');
    expect(m?.targetDate).toBe('until-settled');
    expect(m?.resolvesOn).toBe('9999-12-31T00:00:00Z');
  });

  test('a whole write without horizonTitles clears them, as it does the credits', async () => {
    await request(app)
      .put('/api/metrics/len')
      .send({ timePreference: { enabled: false, halfLife: 1, customHorizons: ['until-settled', '+0w'] } });
    expect((await storedTp()).horizonTitles).toBeUndefined();
    expect((await floorMarket('mkt-open'))?.dateTitle).toBeNull();
  });

  test('a title over 60 characters is refused, and nothing is written', async () => {
    const r = await request(app)
      .put('/api/metrics/len')
      .send({
        timePreference: {
          enabled: false,
          halfLife: 1,
          customHorizons: ['until-settled', '+0w'],
          horizonTitles: { '+0w': 'x'.repeat(61) },
        },
      });
    expect(r.status).toBe(400);
    expect((await storedTp()).horizonTitles).toEqual({ 'until-settled': 'this attempt' });
  });
});

/**
 * The floor says what each book adds to a new proposal, so the posting form
 * can show it beside the proposer's own number (docs/ui-conventions.md,
 * "Posting one"): the owner's "Proposal opens with" for that date, 0 where
 * they set none, and null on a metric proposals are not priced on.
 */
describe('each book says what the floor adds to a new proposal', () => {
  test("the date's proposal number rides the market row, and a date without one says 0", async () => {
    await db
      .update(metrics)
      .set({
        timePreference: {
          enabled: false,
          halfLife: 1,
          customHorizons: ['until-settled', '+0w'],
          horizonCredits: { '+0w': { proposal: 3000 } },
        },
      })
      .where(eq(metrics.id, 'len'));
    expect((await floorMarket('mkt-week'))?.proposalOpensWith).toBe(3000);
    expect((await floorMarket('mkt-open'))?.proposalOpensWith).toBe(0);
    // And when its period ends, which is what decides whether a proposal with
    // a given deadline is priced there at all.
    expect(new Date(String((await floorMarket('mkt-week'))?.periodEndsOn)).getTime()).toBeGreaterThan(Date.now());
  });

  test('a formula metric prices no proposal, so its books say null', async () => {
    await db.update(metrics).set({ formula: 'a + b' }).where(eq(metrics.id, 'len'));
    expect((await floorMarket('mkt-week'))?.proposalOpensWith).toBeNull();
  });
});
