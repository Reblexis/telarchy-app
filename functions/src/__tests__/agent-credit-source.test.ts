/**
 * I5: free credits are minted only for a person
 * (docs/market-integrity.md; owner direction 2026-08-31).
 *
 * Spawning agents has to be free of consequence for the money supply.
 * Several agents per person is wanted, so the defence is not a count of
 * identities: it is that the free routes pay an account, once, and that
 * everything a key-only participant holds came out of somebody else's
 * balance.
 *
 * POST /api/agents/:id/credit was the hole. It added to the target's
 * balance with nothing debited, gated only on the 'manage' capability,
 * and every account can create a workspace whose Admin group holds
 * 'manage'. So it was an unbounded mint available to everyone. These
 * tests are named after the rule rather than the fix.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => require('crypto').createHash('sha256').update(raw).digest('hex'),
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  optionalAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuthWorkspaceMemberships: () => [],
}));

import { eq, sql } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, authUser, creditLedger, creditTransfers, permissionGroups, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { fromUnits, toUnits } from '../lib/validation';
import { agentsRouter } from '../routes/agents';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-credit-source';
const OWNER = 'ws-owner';
const BOT = 'spawned-bot';
const OUTSIDER = 'not-a-member';
const OPERATOR = 'the-operator';

let caller: { agentId?: string; uid?: string; isMasterKey?: boolean; capabilities: Set<string> } = {
  capabilities: new Set(),
};

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as unknown as { auth: typeof caller }).auth = { workspaceId: WS, ...caller } as never;
  next();
});
app.use('/api/agents', agentsRouter);
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
  return res.status(500).json({ error: err.message });
});

/** The workspace owner: a person, with 'manage' in their own workspace. */
const asOwner = () => {
  caller = { agentId: OWNER, uid: 'u-owner', capabilities: new Set(['read', 'trade', 'manage']) };
};
/** A member with no 'manage'. */
const asTrader = () => {
  caller = { agentId: BOT, uid: undefined, capabilities: new Set(['read', 'trade']) };
};
/** The platform operator, who is the one faucet. */
const asOperator = () => {
  caller = { agentId: OPERATOR, uid: 'u-operator', capabilities: new Set(['read', 'trade', 'manage']) };
};

const balanceOf = async (id: string): Promise<number> => {
  const [row] = await db.select({ balance: agents.balance }).from(agents).where(eq(agents.id, id));
  return fromUnits(row.balance as number);
};

/** Every credit that exists anywhere. The number the rule is about. */
const moneySupply = async (): Promise<number> => {
  const [row] = await db.select({ total: sql<string>`coalesce(sum(${agents.balance}), 0)` }).from(agents);
  return fromUnits(Number(row.total));
};

const credit = (targetId: string, amount: number) =>
  request(app).post(`/api/agents/${targetId}/credit`).send({ amount, reason: 'funding a bot' });

beforeAll(async () => {
  await ensureMigrations();
});

beforeEach(async () => {
  await truncateAll();
  await db.insert(authUser).values([
    { id: 'u-owner', name: 'Owner', email: 'owner@example.com' },
    { id: 'u-operator', name: 'Operator', email: 'operator@example.com' },
  ]);
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-owner', balance: toUnits(1000), authUserId: 'u-owner' },
    { id: BOT, apiKeyHash: 'h-bot', balance: toUnits(0) },
    { id: OUTSIDER, apiKeyHash: 'h-out', balance: toUnits(0) },
    { id: OPERATOR, apiKeyHash: 'h-op', balance: toUnits(0), authUserId: 'u-operator', platformAdmin: true },
  ]);
  await db.insert(workspaces).values({ id: WS, name: 'Credit source', createdBy: OWNER, slug: 'credit-source' });
  await db.insert(permissionGroups).values({
    id: 'grp-admin',
    workspaceId: WS,
    name: 'Admin',
    type: 'admin',
    capabilities: ['read', 'trade', 'manage'],
    memberIds: [OWNER, BOT],
  });
  asOwner();
});

describe('POST /api/agents/:id/credit', () => {
  test('CREDITING A PARTICIPANT DEBITS THE CREDITING PARTICIPANT', async () => {
    const before = await moneySupply();
    await credit(BOT, 250).expect(200);

    expect(await balanceOf(BOT)).toBeCloseTo(250);
    expect(await balanceOf(OWNER)).toBeCloseTo(750);
    expect(await moneySupply()).toBeCloseTo(before);
  });

  test('the movement is a transfer, with a receipt both sides can read', async () => {
    await credit(BOT, 40).expect(200);

    const [receipt] = await db.select().from(creditTransfers);
    expect(receipt.fromAgentId).toBe(OWNER);
    expect(receipt.toAgentId).toBe(BOT);
    expect(receipt.credits).toBeCloseTo(40);

    const reasons = (await db.select().from(creditLedger)).map(r => r.reason).sort();
    expect(reasons).toEqual(['transfer_in', 'transfer_out']);
  });

  test('REFUSES WHAT THE CALLER CANNOT AFFORD, and moves nothing', async () => {
    await credit(BOT, 5000).expect(409);

    expect(await balanceOf(BOT)).toBeCloseTo(0);
    expect(await balanceOf(OWNER)).toBeCloseTo(1000);
    expect(await db.select().from(creditTransfers)).toHaveLength(0);
  });

  test('SPAWNING AGENTS MINTS NOTHING, however many are spawned', async () => {
    const before = await moneySupply();
    const spawned = ['bot-1', 'bot-2', 'bot-3', 'bot-4', 'bot-5'];
    await db.insert(agents).values(spawned.map(id => ({ id, apiKeyHash: `h-${id}`, balance: toUnits(0) })));
    await db
      .update(permissionGroups)
      .set({ memberIds: [OWNER, BOT, ...spawned] })
      .where(eq(permissionGroups.id, 'grp-admin'));

    for (const id of spawned) await credit(id, 100).expect(200);

    expect(await moneySupply()).toBeCloseTo(before);
    expect(await balanceOf(OWNER)).toBeCloseTo(500);
  });

  test('THE PLATFORM OPERATOR STILL ISSUES CREDITS, and is the only one who can', async () => {
    asOperator();
    const before = await moneySupply();
    await credit(BOT, 300).expect(200);

    expect(await balanceOf(BOT)).toBeCloseTo(300);
    expect(await balanceOf(OPERATOR)).toBeCloseTo(0);
    expect(await moneySupply()).toBeCloseTo(before + 300);

    const [row] = await db.select().from(creditLedger).where(eq(creditLedger.agentId, BOT));
    expect(row.reason).toBe('admin_adjustment');
  });

  test('still needs manage, and still refuses a target outside the workspace', async () => {
    asTrader();
    await credit(OWNER, 1).expect(403);

    asOwner();
    await credit(OUTSIDER, 1).expect(403);
    await credit('nobody-at-all', 1).expect(404);
    expect(await balanceOf(OWNER)).toBeCloseTo(1000);
  });

  test('rejects a non-positive or non-numeric amount', async () => {
    await credit(BOT, 0).expect(400);
    await credit(BOT, -5).expect(400);
    await request(app).post(`/api/agents/${BOT}/credit`).send({ amount: 'lots' }).expect(400);
    expect(await moneySupply()).toBeCloseTo(1000);
  });
});
