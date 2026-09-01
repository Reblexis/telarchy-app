/**
 * Errors a machine can branch on.
 *
 * Every error on this API is one field: `{ "error": "<an English sentence>" }`.
 * The prose is often good, but the audience is bots, and a bot that wants to
 * treat "you have no credits" differently from "that market already resolved"
 * has to match on a sentence that any copy edit can silently change. Stripe,
 * whose audience is also machines, has carried `type`, `code`, `param` and
 * `doc_url` for a decade for this reason.
 *
 * Two rules hold this together:
 *
 * 1. ADDITIVE. `error` keeps its exact wording and meaning, so nothing that
 *    reads it today breaks. `code` appears BESIDE it.
 * 2. A code is a promise. Once published it is part of the contract and cannot
 *    be repurposed, so the vocabulary is a closed union in one file and every
 *    member has to be documented before this suite passes.
 *
 * Coverage is deliberately partial: the errors a participant branches on are
 * coded, the rest are not yet. An absent `code` therefore means "not coded
 * yet", never "this error cannot happen".
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authMiddleware: (req: any, _res: any, next: any) => {
      const id = req.headers['x-test-agent-id'];
      req.auth = id
        ? { agentId: id, workspaceId: req.headers['x-workspace-id'], capabilities: new Set(['read', 'trade']) }
        : { workspaceId: req.headers['x-workspace-id'], capabilities: new Set(['read']) };
      next();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { GUIDE_SECTIONS } from '../content/guides';
import { agents, markets, metrics, permissionGroups } from '../db/schema';
import { initialPool } from '../lib/amm';
import { apiErrorHandler } from '../lib/api-error-handler';
import { docUrlFor, ERROR_CODES } from '../lib/error-codes';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/predictions', authMiddleware, predictionsRouter);
app.use(apiErrorHandler);

const WS = 'ws-codes';
const OWNER = 'agent-codes-owner';
const BROKE = 'broke-coder';
const RICH = 'rich-coder';
const METRIC = 'metric-codes';
const MARKET = 'market-codes';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await seed();
});

async function seed(): Promise<void> {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-codes-owner', balance: toUnits(0) },
    { id: BROKE, apiKeyHash: 'h-broke-c', balance: toUnits(0) },
    { id: RICH, apiKeyHash: 'h-rich-c', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Error Codes',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS));
  const trader = groups.find(g => g.type === 'trader')!;
  await db
    .update(permissionGroups)
    .set({ memberIds: [BROKE, RICH] })
    .where(eq(permissionGroups.id, trader.id));

  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Activation',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Activation',
    targetDate: '2099-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 100,
    pool: initialPool(100),
    active: true,
    resolved: false,
    voided: false,
  });
}

function trade(agentId: string | null, body: Record<string, unknown>, key?: string) {
  let r = request(app).post('/api/predictions/trade').set('X-Workspace-Id', WS).set('Content-Type', 'application/json');
  if (agentId) r = r.set('X-Test-Agent-Id', agentId);
  if (key) r = r.set('Idempotency-Key', key);
  return r.send(body);
}
const buy = { marketId: MARKET, direction: 'higher', amount: 5 };

describe('the codes a participant branches on', () => {
  test('insufficient_balance', async () => {
    const res = await trade(BROKE, buy);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('insufficient_balance');
    // The numbers that were already there stay where they were.
    expect(res.body.balance).toBe(0);
    expect(res.body.cost).toBeGreaterThan(0);
  });

  test('market_resolved, market_voided and market_closed are three different answers', async () => {
    // A bot retries a closed market's SELL and never retries a resolved one.
    // One shared code would make that impossible to tell apart.
    await db.update(markets).set({ resolved: true }).where(eq(markets.id, MARKET));
    expect((await trade(RICH, buy)).body.code).toBe('market_resolved');

    await db.update(markets).set({ resolved: false, voided: true }).where(eq(markets.id, MARKET));
    expect((await trade(RICH, buy)).body.code).toBe('market_voided');

    await db.update(markets).set({ voided: false, active: false }).where(eq(markets.id, MARKET));
    expect((await trade(RICH, buy)).body.code).toBe('market_closed');
  });

  test('market_not_found', async () => {
    const res = await trade(RICH, { ...buy, marketId: 'no-such-market' });
    expect(res.body.code).toBe('market_not_found');
  });

  test('trade_too_small', async () => {
    const res = await trade(RICH, { ...buy, amount: 1e-12 });
    expect(res.body.code).toBe('trade_too_small');
  });

  test('insufficient_shares', async () => {
    const res = await trade(RICH, { marketId: MARKET, direction: 'higher', sellShares: 99 });
    expect(res.body.code).toBe('insufficient_shares');
  });

  test('idempotency_key_reuse', async () => {
    await trade(RICH, buy, 'code-key');
    const res = await trade(RICH, { ...buy, amount: 50 }, 'code-key');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('idempotency_key_reuse');
  });

  test('not_authorized, and it is a different problem from identity_required', async () => {
    // An anonymous caller on a public floor holds `read` and nothing else, so
    // the capability gate is what refuses a trade. That distinction matters to
    // a bot: registering fixes identity_required, and only being added to a
    // group fixes this one.
    const res = await trade(null, buy);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('not_authorized');
    expect(res.body.requiredCapabilities).toEqual(['trade']);
    expect(res.body.doc_url).toBe(docUrlFor('not_authorized'));
  });
});

describe('the rules that make a code worth having', () => {
  test('ADDITIVE: the error sentence is unchanged and still carries the guidance', async () => {
    const res = await trade(BROKE, buy);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error).toMatch(/Insufficient balance/);
    // The funding hint added for a zero-balance participant still travels.
    expect(res.body.error).toContain('POST /api/agents/transfer');
  });

  test('a code always brings a doc_url', async () => {
    const res = await trade(BROKE, buy);
    expect(res.body.doc_url).toBe(docUrlFor('insufficient_balance'));
    expect(res.body.doc_url).toMatch(/^https:\/\//);
  });

  test('an uncoded error carries no code key at all, rather than a null one', async () => {
    // `"code": null` would look like a code the caller failed to recognise.
    const res = await trade(RICH, { marketId: MARKET });
    expect(res.status).toBe(400);
    expect('code' in res.body).toBe(false);
    expect('doc_url' in res.body).toBe(false);
  });

  test('every published code is documented, or this vocabulary is a lie', async () => {
    const guide = GUIDE_SECTIONS.find(s => s.id === 'api-reference');
    expect(guide).toBeDefined();
    const undocumented = ERROR_CODES.filter(c => !(guide as { content: string }).content.includes(c));
    expect(undocumented).toEqual([]);
  });

  test('the vocabulary has no duplicates', async () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});
