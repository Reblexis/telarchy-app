/**
 * Linking a forecasting record, for any provider (docs/record-links.md).
 *
 * Written before the implementation. What is pinned here is the contract
 * in that doc rather than the shape of the code: the proof, the two
 * uniqueness rules, what qualifies, and the promise that a provider is
 * an object plus a price row and nothing else.
 *
 * Polymarket's side is mocked, but the shapes are the real ones, taken
 * from live responses on 2026-08-31 (a search for a handle, a public
 * profile carrying `createdAt` and `bio`, and the traded count).
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (req: any, _res: any, next: any) => {
      req.auth = {
        agentId: req.headers['x-test-agent-id'],
        workspaceId: req.headers['x-workspace-id'],
        capabilities: new Set(['read', 'trade']),
      };
      next();
    },
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import express from 'express';
import request from 'supertest';
import { agents, earnClaims, earnRules } from '../db/schema';
import { AppError } from '../lib/errors';
import { fromUnits, toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { recordLinkRouter } from '../routes/recordLinks';
import { claimedKeys, clearEarnRuleCache } from '../services/earnRules';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/import', authMiddleware, recordLinkRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const DAY = 86_400_000;
const WALLET = '0x72f7b4aa5acaff9629917cf4ec34620a41c492f7';

// The Polymarket side, controllable per test.
let pmBio = '';
let pmCreatedAt = '';
let pmTraded = 0;
let pmUsernamePublic = true;
let pmFound = true;

const realFetch = global.fetch;

beforeAll(async () => {
  await ensureMigrations();
});

beforeEach(async () => {
  await truncateAll();
  clearEarnRuleCache();
  await db.insert(agents).values([
    { id: 'agent-a', apiKeyHash: 'h-a', balance: toUnits(1000) },
    { id: 'agent-b', apiKeyHash: 'h-b', balance: toUnits(1000) },
  ]);
  await db.insert(earnRules).values([
    { key: 'polymarket_link', label: 'Link a Polymarket record', credits: 5000, kind: 'flat', note: '' },
    { key: 'manifold_link', label: 'Link a Manifold record', credits: 5000, kind: 'flat', note: '' },
  ]);
  clearEarnRuleCache();

  // An established account by default; the gate tests set their own.
  pmBio = '';
  pmCreatedAt = new Date(Date.now() - 200 * DAY).toISOString();
  pmTraded = 366;
  pmUsernamePublic = true;
  pmFound = true;

  global.fetch = jest.fn(async (url: any) => {
    const u = String(url);
    if (u.includes('/public-search')) {
      return new Response(
        JSON.stringify({
          events: [],
          profiles: pmFound
            ? [
                {
                  name: 'crypto-basenji',
                  pseudonym: 'Electric-Architect',
                  displayUsernamePublic: pmUsernamePublic,
                  proxyWallet: WALLET,
                },
              ]
            : [],
        }),
        { status: 200 },
      );
    }
    if (u.includes('/public-profile')) {
      return new Response(
        JSON.stringify({
          createdAt: pmCreatedAt,
          proxyWallet: WALLET,
          displayUsernamePublic: pmUsernamePublic,
          name: 'crypto-basenji',
          ...(pmUsernamePublic ? { bio: pmBio } : {}),
        }),
        { status: 200 },
      );
    }
    if (u.includes('/traded')) {
      return new Response(JSON.stringify({ user: WALLET, traded: pmTraded }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as any;
});

afterAll(() => {
  global.fetch = realFetch;
});

function as(agentId: string, provider = 'polymarket') {
  const headers = (r: request.Test) =>
    r.set('X-Test-Agent-Id', agentId).set('X-Workspace-Id', 'ws-any').set('Content-Type', 'application/json');
  return {
    start: (handle: string) => headers(request(app).post(`/api/import/${provider}/start`)).send({ handle }),
    claim: () => headers(request(app).post(`/api/import/${provider}/claim`)).send({}),
  };
}

const balanceOf = async (id: string) => {
  const [a] = await db.select().from(agents).where(require('drizzle-orm').eq(agents.id, id));
  return fromUnits(a.balance as number);
};

/** Walk one account all the way through a successful link. */
async function link(agentId: string) {
  const started = await as(agentId).start('crypto-basenji');
  pmBio = `Only smart plays. ${started.body.code}`;
  return as(agentId).claim();
}

describe('starting a link', () => {
  test('answers with a one-time code and says where it goes', async () => {
    const r = await as('agent-a').start('crypto-basenji');
    expect(r.status).toBe(200);
    expect(r.body.code).toMatch(/^telarchy-[0-9a-f]{8}$/);
    expect(r.body.handle).toBe('crypto-basenji');
    expect(r.body.proofField).toBe('bio');
  });

  test('AN UNKNOWN PROVIDER IS A 404, not a crash', async () => {
    const r = await as('agent-a', 'metaculus').start('someone');
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/metaculus/i);
  });

  test('a handle nobody has is a 404 that names it', async () => {
    pmFound = false;
    const r = await as('agent-a').start('nobody-at-all');
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/nobody-at-all/);
  });

  test('a handle of the wrong shape is refused before any lookup', async () => {
    const r = await as('agent-a').start('not a handle!!');
    expect(r.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('A PRIVATE PROFILE IS REFUSED, because its bio cannot be read', async () => {
    // Nothing could prove ownership, so say that rather than handing out
    // a code that can never verify.
    pmUsernamePublic = false;
    const r = await as('agent-a').start('crypto-basenji');
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/public/i);
  });
});

describe('claiming', () => {
  test('the code in the bio proves it, and pays the table price', async () => {
    const r = await link('agent-a');
    expect(r.status).toBe(200);
    expect(r.body.granted).toBe(5000);
    expect(await balanceOf('agent-a')).toBeCloseTo(6000, 5);
  });

  test('NO CODE IN THE BIO GRANTS NOTHING', async () => {
    await as('agent-a').start('crypto-basenji');
    pmBio = 'no code here';
    const r = await as('agent-a').claim();
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/bio/i);
    expect(await balanceOf('agent-a')).toBeCloseTo(1000, 5);
  });

  test('claiming before starting is refused', async () => {
    const r = await as('agent-a').claim();
    expect(r.status).toBe(400);
    expect(await balanceOf('agent-a')).toBeCloseTo(1000, 5);
  });

  test('the claim records the EXTERNAL ID, not the handle', async () => {
    await link('agent-a');
    const [claim] = await db.select().from(earnClaims);
    expect(claim.key).toBe('polymarket_link');
    expect(claim.refId).toBe(WALLET);
    expect(claim.credits).toBe(5000);
  });
});

describe('the two uniqueness rules', () => {
  test('ONE EXTERNAL ACCOUNT CANNOT FUND TWO TELARCHY ACCOUNTS', async () => {
    // The rule the whole design leans on. Without it one aged Polymarket
    // wallet is an unlimited credit printer across fresh accounts.
    expect((await link('agent-a')).status).toBe(200);
    const second = await as('agent-b').start('crypto-basenji');
    expect(second.status).toBe(409);
    expect(await balanceOf('agent-b')).toBeCloseTo(1000, 5);
  });

  test('ONE PARTICIPANT CANNOT LINK THE SAME PROVIDER TWICE', async () => {
    expect((await link('agent-a')).status).toBe(200);
    const again = await as('agent-a').start('crypto-basenji');
    expect(again.status).toBe(409);
    expect(await balanceOf('agent-a')).toBeCloseTo(6000, 5);
  });

  test('a replayed claim after a successful link grants nothing more', async () => {
    await link('agent-a');
    const replay = await as('agent-a').claim();
    expect(replay.status).not.toBe(200);
    expect(await balanceOf('agent-a')).toBeCloseTo(6000, 5);
  });

  test('ONE PARTICIPANT CAN LINK TWO DIFFERENT PROVIDERS and is paid for each', async () => {
    await link('agent-a');
    expect([...(await claimedKeys('agent-a'))]).toEqual(['polymarket_link']);
    // The providers are independent: the second is not blocked by the
    // first, which is what makes the table additive.
    const started = await as('agent-a', 'manifold').start('crypto-basenji');
    expect(started.status).not.toBe(409);
  });
});

describe('what qualifies', () => {
  test('A FRESH ACCOUNT EARNS NOTHING, and is told how old it is', async () => {
    pmCreatedAt = new Date(Date.now() - 10 * DAY).toISOString();
    const started = await as('agent-a').start('crypto-basenji');
    // Refused before a code is even issued: nobody should edit their bio
    // for a record that could never have been paid.
    expect(started.status).toBe(400);
    expect(started.body.error).toMatch(/days old/);
    expect(started.body.code).toBeUndefined();
    expect(await balanceOf('agent-a')).toBeCloseTo(1000, 5);
  });

  test('AN AGED ACCOUNT THAT NEVER TRADED EARNS NOTHING', async () => {
    pmTraded = 0;
    const started = await as('agent-a').start('crypto-basenji');
    expect(started.status).toBe(400);
    expect(started.body.error).toMatch(/traded/i);
    expect(await balanceOf('agent-a')).toBeCloseTo(1000, 5);
  });

  test('the gates are checked at CLAIM, so aging out mid-flow cannot pay', async () => {
    const started = await as('agent-a').start('crypto-basenji');
    pmBio = started.body.code;
    pmTraded = 1;
    const r = await as('agent-a').claim();
    expect(r.status).toBe(400);
    expect(await balanceOf('agent-a')).toBeCloseTo(1000, 5);
  });

  test('MONEY NEVER DECIDES THE GRANT: the profit endpoints are not even read', async () => {
    // The 2026-08-30 rule generalised: USDC and positions move between
    // wallets, so any wealth-shaped signal is the one a farmer can pool.
    await link('agent-a');
    const urls = (global.fetch as jest.Mock).mock.calls.map(c => String(c[0]));
    expect(urls.some(u => /value|positions|pnl|leaderboard/i.test(u))).toBe(false);
  });
});

describe('the price', () => {
  test('is the table price on the day, and a later re-price does not change it', async () => {
    await db
      .update(earnRules)
      .set({ credits: 1234 })
      .where(require('drizzle-orm').eq(earnRules.key, 'polymarket_link'));
    clearEarnRuleCache();
    const r = await link('agent-a');
    expect(r.body.granted).toBe(1234);

    await db
      .update(earnRules)
      .set({ credits: 9999 })
      .where(require('drizzle-orm').eq(earnRules.key, 'polymarket_link'));
    clearEarnRuleCache();
    const [claim] = await db.select().from(earnClaims);
    expect(claim.credits).toBe(1234);
  });

  test('a disabled row links the record and grants zero rather than failing', async () => {
    await db
      .update(earnRules)
      .set({ enabled: false })
      .where(require('drizzle-orm').eq(earnRules.key, 'polymarket_link'));
    clearEarnRuleCache();
    const r = await link('agent-a');
    expect(r.status).toBe(200);
    expect(r.body.granted).toBe(0);
    expect(await balanceOf('agent-a')).toBeCloseTo(1000, 5);
  });
});
