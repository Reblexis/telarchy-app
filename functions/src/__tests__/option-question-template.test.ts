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
import { agents, markets, metrics, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { marketplaceRouter } from '../routes/marketplace';
import { workspacesRouter } from '../routes/workspaces';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
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

const TEMPLATE = "If the move {option} is made, what will {workspace}'s final {metric} be {date}?";
describe('WORKSPACE QUESTION WORDING', () => {
  test('a manager can save wording and every reader receives it', async () => {
    await seed();
    expect((await put({ optionQuestionTemplate: `  ${TEMPLATE}  ` }, 'read,manage')).status).toBe(200);
    expect((await floor()).optionQuestionTemplate).toBe(TEMPLATE);
    expect((await getWs()).body.optionQuestionTemplate).toBe(TEMPLATE);
  });
  test('only a manager may change workspace question wording', async () => {
    await seed();
    expect((await put({ optionQuestionTemplate: TEMPLATE }, TRADER_CAPS)).status).toBe(403);
    expect((await floor()).optionQuestionTemplate).toBeNull();
  });
  test.each([null, '', '   '])('clearing with %p restores the default', async value => {
    await seed();
    await put({ optionQuestionTemplate: TEMPLATE });
    expect((await put({ optionQuestionTemplate: value })).status).toBe(200);
    expect((await floor()).optionQuestionTemplate).toBeNull();
  });
  test.each([
    5,
    false,
    {},
    [],
    '{wrong} {option}',
    '{option',
    'option}',
    'No selected option',
    '{option}' + 'x'.repeat(493),
  ])('invalid template %p is refused without changing stored wording', async value => {
    await seed();
    await put({ optionQuestionTemplate: TEMPLATE });
    expect((await put({ optionQuestionTemplate: value })).status).toBe(400);
    expect((await floor()).optionQuestionTemplate).toBe(TEMPLATE);
  });
  test('accepts the 500 character boundary and repeated known placeholders', async () => {
    await seed();
    const text = '{option}' + 'x'.repeat(492);
    expect((await put({ optionQuestionTemplate: text })).status).toBe(200);
    expect((await floor()).optionQuestionTemplate).toBe(text);
    expect((await put({ optionQuestionTemplate: '{option} or {option} {workspace} {metric} {date}' })).status).toBe(
      200,
    );
  });
  test('an unrelated settings edit preserves the template', async () => {
    await seed();
    await put({ optionQuestionTemplate: TEMPLATE });
    await put({ description: 'New description' });
    expect((await floor()).optionQuestionTemplate).toBe(TEMPLATE);
  });
});
