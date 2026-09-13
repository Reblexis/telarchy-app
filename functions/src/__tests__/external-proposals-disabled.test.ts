/**
 * A floor closed to outside proposals (docs/guides/proposals.md, "Closing
 * the floor to outside proposals"; owner ask 2026-09-13: "add support for
 * disabling proposals made by other users for workspace owners").
 *
 * The rule: while `externalProposalsDisabled` is true, only a caller holding
 * `manage` on the floor may post a proposal; anyone else is refused with 403
 * `external_proposals_disabled` and nothing is created or charged. It is
 * false by default, so every existing floor accepts proposals as before; it
 * is a lifecycle setting (manage_workspace); the public floor payload and the
 * brief say so, so a closed floor does not offer what it would refuse.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (req: any, _res: any, next: any) => {
    const caps = req.headers['x-test-caps']
      ? String(req.headers['x-test-caps']).split(',')
      : ['read', 'trade', 'manage', 'manage_workspace'];
    req.auth = {
      agentId: req.headers['x-test-agent-id'],
      workspaceId: req.headers['x-workspace-id'],
      capabilities: new Set(caps),
      isMasterKey: req.headers['x-test-master'] === '1',
    };
    next();
  },
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../lib/notify', () => ({
  publicOrigin: () => 'https://telarchy.com',
  notifyOwner: async () => {},
  sendEmail: async () => true,
}));

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { marketplaceRouter } from '../routes/marketplace';
import { proposalsRouter } from '../routes/proposals';
import { workspacesRouter } from '../routes/workspaces';
import { buildWorkspaceContext, renderContextMarkdown } from '../services/workspace-context';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/proposals', authMiddleware, proposalsRouter);
app.use('/api/workspaces', authMiddleware, workspacesRouter);
app.use('/api/marketplace', marketplaceRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message, code: (err as AppError).code });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-closed';
const OWNER = 'agent-owner';
const OUTSIDER = 'agent-outsider';
const TRADER_CAPS = 'read,trade';
const OWNER_CAPS = 'read,trade,manage,manage_workspace';

async function seed(opts: { closed?: boolean } = {}) {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-owner', balance: toUnits(1000) },
    { id: OUTSIDER, apiKeyHash: 'h-outsider', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Snake',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  await db.update(workspaces).set({ slug: 'snake' }).where(eq(workspaces.id, WS));
  if (opts.closed) {
    await db.update(workspaces).set({ externalProposalsDisabled: true }).where(eq(workspaces.id, WS));
  }
  await db.insert(metrics).values({
    id: 'metric-len',
    workspaceId: WS,
    name: 'Reached length',
    value: 2,
    formula: '0',
    marketRangeMax: 16,
  });
  await db.insert(markets).values({
    id: 'mkt-far',
    workspaceId: WS,
    metricId: 'metric-len',
    metricName: 'Reached length',
    targetDate: '2099',
    rangeMin: 0,
    rangeMax: 16,
    shares: [0, 0],
    liquidity: 100,
    pool: initialPool(100),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    branch: null,
  });
}

const post = (body: Record<string, unknown>, agent: string, caps: string) =>
  request(app)
    .post('/api/proposals')
    .set('X-Test-Agent-Id', agent)
    .set('X-Workspace-Id', WS)
    .set('X-Test-Caps', caps)
    .send(body);

const put = (body: Record<string, unknown>, caps = OWNER_CAPS) =>
  request(app)
    .put(`/api/workspaces/${WS}/settings`)
    .set('X-Test-Agent-Id', OWNER)
    .set('X-Workspace-Id', WS)
    .set('X-Test-Caps', caps)
    .send(body);

const getWs = () =>
  request(app)
    .get(`/api/workspaces/${WS}`)
    .set('X-Test-Agent-Id', OWNER)
    .set('X-Workspace-Id', WS)
    .set('X-Test-Master', '1');

const floor = async () => (await request(app).get(`/api/marketplace/${WS}`)).body;

async function proposalCount() {
  return (await db.select({ id: proposals.id }).from(proposals).where(eq(proposals.workspaceId, WS))).length;
}

async function balanceOf(id: string) {
  const [row] = await db.select({ b: agents.balance }).from(agents).where(eq(agents.id, id));
  return row.b;
}

describe('ONLY THE OWNER POSTS PROPOSALS ON A FLOOR CLOSED TO OUTSIDE PROPOSALS', () => {
  test('a participant without manage is refused with 403 external_proposals_disabled, and nothing is created', async () => {
    await seed({ closed: true });
    const res = await post({ title: 'Turn left' }, OUTSIDER, TRADER_CAPS);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('external_proposals_disabled');
    expect(res.body.error).toMatch(/owner/i);
    expect(await proposalCount()).toBe(0);
  });

  test('the refusal charges nothing: an outsider offering a subsidy keeps every credit', async () => {
    await seed({ closed: true });
    const before = await balanceOf(OUTSIDER);
    const res = await post({ title: 'Turn left', liquiditySubsidy: 50 }, OUTSIDER, TRADER_CAPS);
    expect(res.status).toBe(403);
    expect(await balanceOf(OUTSIDER)).toBe(before);
    expect(await db.select().from(markets).where(eq(markets.workspaceId, WS))).toHaveLength(1);
  });

  test('a proposal with options from an outsider is refused the same way', async () => {
    await seed({ closed: true });
    const res = await post(
      {
        title: 'Game 1, move 1',
        options: [
          { id: 'left', label: 'Turn left' },
          { id: 'right', label: 'Turn right' },
        ],
      },
      OUTSIDER,
      TRADER_CAPS,
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('external_proposals_disabled');
    expect(await proposalCount()).toBe(0);
  });

  test('the owner still posts (the snake operator is the owner of its floor)', async () => {
    await seed({ closed: true });
    const res = await post(
      {
        title: 'Game 1, move 1',
        options: [
          { id: 'forward', label: 'Continue forward' },
          { id: 'left', label: 'Turn left' },
        ],
      },
      OWNER,
      OWNER_CAPS,
    );
    expect(res.status).toBe(201);
    expect(await proposalCount()).toBe(1);
  });

  test('an admin the owner added (manage without manage_workspace) still posts', async () => {
    await seed({ closed: true });
    const res = await post({ title: 'Rewrite the rules page' }, OUTSIDER, 'read,trade,manage');
    expect(res.status).toBe(201);
  });

  test('a proposal posted before the floor closed stays, and its proposer can still withdraw it', async () => {
    await seed();
    const created = await post({ title: 'Turn right' }, OUTSIDER, TRADER_CAPS);
    expect(created.status).toBe(201);
    await db.update(workspaces).set({ externalProposalsDisabled: true }).where(eq(workspaces.id, WS));
    const [row] = await db.select().from(proposals).where(eq(proposals.id, created.body.id));
    expect(row.status).toBe('pending');
    const withdrawn = await request(app)
      .post(`/api/proposals/${created.body.id}/withdraw`)
      .set('X-Test-Agent-Id', OUTSIDER)
      .set('X-Workspace-Id', WS)
      .set('X-Test-Caps', TRADER_CAPS)
      .send({});
    expect(withdrawn.status).toBe(200);
  });
});

describe('A FLOOR IS OPEN TO PROPOSALS BY DEFAULT (regression guard)', () => {
  test('a fresh workspace reports false on the workspace and on the public floor', async () => {
    await seed();
    const ws = await getWs();
    expect(ws.status).toBe(200);
    expect(ws.body.externalProposalsDisabled).toBe(false);
    expect(await floor()).toHaveProperty('externalProposalsDisabled', false);
  });

  test('a participant with trade posts on an open floor, as before', async () => {
    await seed();
    const res = await post({ title: 'Turn left' }, OUTSIDER, TRADER_CAPS);
    expect(res.status).toBe(201);
    expect(await proposalCount()).toBe(1);
  });

  test('reopening a closed floor lets outsiders post again', async () => {
    await seed({ closed: true });
    expect((await post({ title: 'Turn left' }, OUTSIDER, TRADER_CAPS)).status).toBe(403);
    expect((await put({ externalProposalsDisabled: false })).status).toBe(200);
    expect((await post({ title: 'Turn left' }, OUTSIDER, TRADER_CAPS)).status).toBe(201);
  });
});

describe('the setting: PUT /api/workspaces/:id/settings { externalProposalsDisabled }', () => {
  test('accepts true and false, read back on the workspace and the public floor', async () => {
    await seed();
    expect((await put({ externalProposalsDisabled: true })).status).toBe(200);
    expect((await getWs()).body.externalProposalsDisabled).toBe(true);
    expect((await floor()).externalProposalsDisabled).toBe(true);
    expect((await put({ externalProposalsDisabled: false })).status).toBe(200);
    expect((await getWs()).body.externalProposalsDisabled).toBe(false);
  });

  test('rejects anything but a boolean with 400 and stores nothing', async () => {
    await seed();
    for (const bad of ['true', 1, null, {}, []]) {
      const res = await put({ externalProposalsDisabled: bad });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('externalProposalsDisabled');
    }
    expect((await getWs()).body.externalProposalsDisabled).toBe(false);
  });

  test('CLOSING A FLOOR REQUIRES manage_workspace: plain manage gets 403 and changes nothing', async () => {
    await seed();
    expect((await put({ externalProposalsDisabled: true }, 'read,trade,manage')).status).toBe(403);
    expect((await getWs()).body.externalProposalsDisabled).toBe(false);
  });

  test('a trader cannot close a floor', async () => {
    await seed();
    expect((await put({ externalProposalsDisabled: true }, TRADER_CAPS)).status).toBe(403);
    expect((await getWs()).body.externalProposalsDisabled).toBe(false);
  });

  test('a settings write that does not name it leaves it alone', async () => {
    await seed({ closed: true });
    expect((await put({ description: 'A snake steered by a market' })).status).toBe(200);
    expect((await getWs()).body.externalProposalsDisabled).toBe(true);
  });
});

describe('the brief does not invite proposals a closed floor would refuse', () => {
  test('closed: the brief says the owner alone posts proposals', async () => {
    await seed({ closed: true });
    const ctx = await buildWorkspaceContext(WS);
    const md = renderContextMarkdown(ctx!);
    expect(md).not.toContain('anyone may post a proposal');
    expect(md).toContain('only the owner posts proposals');
    expect(ctx!.externalProposalsDisabled).toBe(true);
  });

  test('open: the brief still says anyone may post a proposal', async () => {
    await seed();
    const ctx = await buildWorkspaceContext(WS);
    expect(renderContextMarkdown(ctx!)).toContain('anyone may post a proposal');
    expect(ctx!.externalProposalsDisabled).toBe(false);
  });
});
