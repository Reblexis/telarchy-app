/**
 * The pending-proposals cap never applies to anyone who can review the queue.
 *
 * docs/guides/proposals.md: maxPendingProposalsPerParticipant is a brake on
 * what strangers can queue for a reviewer to look at; a reviewer's own
 * contracts are theirs to manage, so whoever holds manage on the floor (the
 * owner, their admins, a platform admin acting there) may post any number of
 * pending contracts whatever the cap says. Everyone else is still refused
 * with 429 { pending, cap } once they reach it.
 *
 * Owner report 2026-09-02: the owner of a floor with cap 3 was refused their
 * fourth contract with "You have 3 pending proposals; this workspace allows
 * at most 3 per participant." A first fix exempted the workspace's creator
 * row only, and the owner was still refused: the Telarchy and LookPilot
 * floors were created by the admin account, and the owner posts there as a
 * platform admin, i.e. as a reviewer who is not the creator.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (req: any, _res: any, next: any) => {
      // Capabilities come from the x-test-caps header (default: a plain
      // trader), so a test can say who is a reviewer and who is a stranger.
      const caps = String(req.headers['x-test-caps'] ?? 'read,trade').split(',');
      req.auth = {
        agentId: req.headers['x-test-agent-id'],
        workspaceId: req.headers['x-workspace-id'],
        capabilities: new Set(caps),
      };
      next();
    },
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { proposalsRouter } from '../routes/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/proposals', authMiddleware, proposalsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-owner-uncapped';
const OWNER = 'agent-uncapped-owner';
const STRANGER = 'agent-uncapped-stranger';
// A reviewer who is not the creator row: an admin the owner added, or a
// platform admin acting on a floor the admin account created.
const REVIEWER = 'agent-uncapped-reviewer';

async function seed(maxPending: number) {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-ou-owner', balance: toUnits(1000) },
    { id: STRANGER, apiKeyHash: 'h-ou-stranger', balance: toUnits(1000) },
    { id: REVIEWER, apiKeyHash: 'h-ou-reviewer', balance: toUnits(1000), platformAdmin: true },
  ]);
  await db.insert(workspaces).values({
    id: WS,
    name: 'Owner Uncapped',
    createdBy: OWNER,
    visibility: 'public',
    maxPendingProposalsPerParticipant: maxPending,
  });
  await db.insert(metrics).values({
    id: 'metric-ou',
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: 'mkt-base-ou',
    workspaceId: WS,
    metricId: 'metric-ou',
    metricName: 'Revenue',
    targetDate: '2026-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 10,
    pool: initialPool(10),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    branch: null,
  });
}

function submit(agentId: string, title: string, caps = 'read,trade') {
  return request(app)
    .post('/api/proposals')
    .set('x-workspace-id', WS)
    .set('x-test-agent-id', agentId)
    .set('x-test-caps', caps)
    .send({ title, description: '' });
}
const asOwner = (title: string) => submit(OWNER, title, 'read,trade,manage');
const asReviewer = (title: string) => submit(REVIEWER, title, 'read,trade,manage');

async function pendingOf(agentId: string) {
  const rows = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(and(eq(proposals.workspaceId, WS), eq(proposals.proposedBy, agentId), eq(proposals.status, 'pending')));
  return rows.length;
}

describe('the pending-proposals cap never applies to anyone who can review the queue', () => {
  test('the owner posts past the cap and every contract is accepted', async () => {
    await seed(3);
    for (let i = 1; i <= 5; i++) {
      const r = await asOwner(`Owner contract ${i}`);
      expect([r.status, r.body.error]).toEqual([201, undefined]);
    }
    expect(await pendingOf(OWNER)).toBe(5);
  });

  test('the owner posts past a cap of one, the tightest the owner could set', async () => {
    await seed(1);
    expect((await asOwner('First')).status).toBe(201);
    expect((await asOwner('Second')).status).toBe(201);
    expect(await pendingOf(OWNER)).toBe(2);
  });

  test('a reviewer who is not the creator row (platform admin on a floor the admin account made) is not capped', async () => {
    await seed(3);
    for (let i = 1; i <= 5; i++) {
      const r = await asReviewer(`Reviewer contract ${i}`);
      expect([r.status, r.body.error]).toEqual([201, undefined]);
    }
    expect(await pendingOf(REVIEWER)).toBe(5);
  });

  test('an admin the owner added (manage, not platform admin, not creator) is not capped', async () => {
    await seed(1);
    await db.insert(agents).values({ id: 'agent-uncapped-teammate', apiKeyHash: 'h-ou-team', balance: toUnits(1000) });
    expect((await submit('agent-uncapped-teammate', 'One', 'read,trade,manage')).status).toBe(201);
    expect((await submit('agent-uncapped-teammate', 'Two', 'read,trade,manage')).status).toBe(201);
  });

  test('a platform-admin flag alone does nothing: it is the manage capability that lifts the cap', async () => {
    // The auth layer grants a platform admin manage everywhere; the route
    // reads the capability set it is given, so a caller presented without
    // manage is capped like any trader.
    await seed(1);
    expect((await submit(REVIEWER, 'One', 'read,trade')).status).toBe(201);
    expect((await submit(REVIEWER, 'Two', 'read,trade')).status).toBe(429);
  });

  test('everyone else is still refused with 429 { pending, cap } at the cap', async () => {
    await seed(3);
    for (let i = 1; i <= 3; i++) expect((await submit(STRANGER, `Stranger ${i}`)).status).toBe(201);
    const r = await submit(STRANGER, 'Stranger 4');
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ pending: 3, cap: 3 });
    expect(r.body.error).toMatch(/at most 3 per participant/);
    expect(await pendingOf(STRANGER)).toBe(3);
  });

  test("the owner's own pile does not count against anyone else", async () => {
    await seed(1);
    for (let i = 1; i <= 3; i++) expect((await asOwner(`Owner ${i}`)).status).toBe(201);
    expect((await submit(STRANGER, 'Stranger 1')).status).toBe(201);
    expect((await submit(STRANGER, 'Stranger 2')).status).toBe(429);
  });

  test('a cap of zero is off for everyone', async () => {
    await seed(0);
    for (let i = 1; i <= 4; i++) expect((await submit(STRANGER, `Stranger ${i}`)).status).toBe(201);
    for (let i = 1; i <= 4; i++) expect((await asOwner(`Owner ${i}`)).status).toBe(201);
  });
});
