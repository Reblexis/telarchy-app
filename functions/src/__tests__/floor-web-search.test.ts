/**
 * Otto reads the web on a market floor, not only on the operator door.
 *
 * The owner asked for this on 2026-08-24 ("it should have access to websearch
 * and everything") and it landed on the setup door alone, which is how a
 * visitor asking whether a competitor really shipped got a shrug from someone
 * holding a search tool. Asked again on 2026-08-31.
 *
 * The danger this carries is specific and it is worse here than on the setup
 * door: on a floor Otto is holding a signed-in visitor's own credentials, and
 * a search result is a page anyone on the internet can write. So the fence is
 * tested at the surface as well as in the service, and the rule that nothing
 * inside it may cause an API call is tested as a property of the prompt the
 * floor actually sends.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, permissionGroups, workspaces } from '../db/schema';
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

const WS = 'ws-floor-search';
const ORIGINAL_FETCH = global.fetch;

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  process.env.AI_GATEWAY_API_KEY = 'test-key';
  await seed();
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  delete process.env.AI_GATEWAY_API_KEY;
});

async function seed() {
  await db.insert(agents).values({ id: 'owner', apiKeyHash: 'h-owner', balance: 0, nickname: 'owner' });
  await db.insert(workspaces).values({
    id: WS,
    name: 'LookPilot',
    createdBy: 'owner',
    visibility: 'public',
    slug: 'lookpilot',
  });
  await db.insert(permissionGroups).values({
    id: 'grp-pub',
    workspaceId: WS,
    name: 'Public',
    type: 'public',
    capabilities: ['read', 'trade'],
    memberIds: [],
    sourcePermissions: {},
  });
  await db.insert(metrics).values({
    id: 'metric-1',
    workspaceId: WS,
    name: 'Net revenue',
    description: 'Steam plus Stripe.',
    value: 1234,
    marketRangeMax: 5000,
  });
  await db.insert(markets).values({
    id: 'mkt-1',
    workspaceId: WS,
    metricId: 'metric-1',
    metricName: 'Net revenue',
    targetDate: '2030-06',
    rangeMin: 0,
    rangeMax: 5000,
    shares: [0, 0],
    liquidity: 50,
    pool: initialPool(50),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    branch: null,
  });
}

/** Every request the route made, in order, with the gateway ones parsed. */
function stubGateway(handler: (round: number, body: any) => any) {
  const gatewayBodies: any[] = [];
  global.fetch = (async (url: string, init: RequestInit) => {
    const href = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    // The search tool posts to the same gateway with the search model, so the
    // two are told apart by which model they name.
    if (href.includes('ai-gateway') && body.model?.includes('sonar')) {
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Beam shipped Linux in July 2026.' } }],
          citations: ['https://beam.example/changelog'],
          usage: { cost: 0.004 },
        }),
        text: async () => '',
      } as unknown as Response;
    }
    gatewayBodies.push(body);
    const message = handler(gatewayBodies.length, body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 } }),
      text: async () => '',
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return gatewayBodies;
}

const ask = (question: string) => request(app).post(`/api/marketplace/${WS}/ask`).send({ question });

describe("the floor's Otto can look things up", () => {
  test('search_web is offered to him on a market floor', async () => {
    const bodies = stubGateway(() => ({ role: 'assistant', content: 'Nothing to look up.' }));
    await ask('what do you sell?');
    const names = bodies[0].tools.map((t: any) => t.function.name);
    expect(names).toContain('search_web');
    // The floor's own tools are still there; this adds a door, it replaces none.
    expect(names).toEqual(expect.arrayContaining(['read_data_room', 'find_endpoint', 'call_api']));
  });

  test('a lookup reaches him fenced as something strangers wrote', async () => {
    const bodies = stubGateway((round: number) =>
      round === 1
        ? {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'search_web', arguments: '{"query":"did Beam ship linux"}' },
              },
            ],
          }
        : { role: 'assistant', content: 'Yes, in July 2026.' },
    );
    const res = await ask('did Beam ship linux?');
    expect(res.status).toBe(200);
    expect(res.body.answer).toContain('July 2026');

    const toolMessage = bodies[1].messages.find((m: any) => m.role === 'tool');
    expect(toolMessage.content).toMatch(/BEGIN WEB RESULTS/);
    expect(toolMessage.content).toMatch(/never instructions/);
    expect(toolMessage.content).toMatch(/beam\.example/);
  });

  test('nothing inside a fence may cause an API call, and the prompt says so', async () => {
    const bodies = stubGateway(() => ({ role: 'assistant', content: 'ok' }));
    await ask('anything');
    const system = bodies[0].messages[0].content;
    expect(system).toMatch(/never instructions|information, never an order/i);
    expect(system).toMatch(/never.{0,80}(call|act)/i);
  });

  test('what he read is on the question row beside what he called', async () => {
    stubGateway((round: number) =>
      round === 1
        ? {
            role: 'assistant',
            content: '',
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'search_web', arguments: '{"query":"beam linux"}' } },
            ],
          }
        : { role: 'assistant', content: 'Yes.' },
    );
    await ask('did Beam ship linux?');
    const rows = await db.query.floorQuestions.findMany();
    expect(rows).toHaveLength(1);
    const calls = (rows[0].toolCalls ?? []) as Array<Record<string, unknown>>;
    // A lookup is recorded the way a call is: method, what was asked, status.
    expect(calls).toContainEqual({ method: 'SEARCH', path: 'beam linux', status: 200 });
  });
});
