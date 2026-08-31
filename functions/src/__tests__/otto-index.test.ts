/**
 * What Otto is handed, and what he has to go and get.
 *
 * The brief is the right payload for an outside agent and the wrong system
 * prompt for an assistant: handed every number already flattened onto one
 * page, he answers from the page instead of looking. That is not a theory,
 * it is the question log for 2026-08-31 (zero tool calls on the answer that
 * got four things wrong). So the floor hands him an index and he fetches.
 *
 * These tests are named after what each rule protects. The load-bearing one
 * is that no priced number reaches him unasked, because the moment one does
 * the whole mechanism is back to where it started.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import express from 'express';
import request from 'supertest';
import {
  agents,
  announcements,
  markets,
  metrics,
  permissionGroups,
  proposalMessages,
  proposals,
  sources,
  workspaces,
} from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { marketplaceRouter } from '../routes/marketplace';
import { buildWorkspaceContext, renderContextIndex, renderContextMarkdown } from '../services/workspace-context';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const WS = 'ws-index';
const ORIGINAL_FETCH = global.fetch;

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
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
    name: 'Telarchy',
    createdBy: 'owner',
    visibility: 'public',
    slug: 'telarchy',
    description: 'This platform, running on itself.',
    charter: 'I approve on the number, or I say why not.',
  });
  await db.insert(permissionGroups).values({
    id: 'grp-pub',
    workspaceId: WS,
    name: 'Public',
    type: 'public',
    capabilities: ['read', 'trade'],
    memberIds: [],
    sourcePermissions: { 'src-room': { read: true } },
  });
  await db.insert(sources).values({
    id: 'src-room',
    workspaceId: WS,
    name: 'Data room',
    description: 'The numbers behind the numbers',
    type: 'text',
    content: 'Revenue is Steam developer share plus Stripe.',
  });
  await db.insert(announcements).values({
    id: 'ann-1',
    workspaceId: WS,
    body: 'Trader rewards shipped on Thursday.',
    publishedAt: new Date('2026-08-28'),
  });
  await db.insert(metrics).values({
    id: 'metric-1',
    workspaceId: WS,
    name: 'Weekly active verified traders',
    description: 'Distinct verified participants who traded in the trailing 7 days.',
    value: 4,
    marketRangeMax: 50,
  });
  await db.insert(proposals).values({
    id: 'prop-1',
    workspaceId: WS,
    proposedBy: 'owner',
    title: '$300: Post a Manifold market',
    description: 'A LONG PITCH nobody needs before they have asked about this contract.',
    askUsd: 300,
    status: 'approved',
  });
  await db.insert(proposalMessages).values({
    id: 'msg-1',
    workspaceId: WS,
    proposalId: 'prop-1',
    from: 'owner',
    content: 'A COMMENT that belongs on the contract, not in his head.',
  });
  await db.insert(markets).values([
    {
      id: 'mkt-base',
      workspaceId: WS,
      metricId: 'metric-1',
      metricName: 'Weekly active verified traders',
      targetDate: '2030-06',
      rangeMin: 0,
      rangeMax: 50,
      shares: [0, 5],
      liquidity: 100,
      pool: initialPool(100),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
      branch: null,
    },
    {
      id: 'mkt-appr',
      workspaceId: WS,
      metricId: 'metric-1',
      metricName: 'Weekly active verified traders',
      targetDate: '2030-06',
      rangeMin: 0,
      rangeMax: 50,
      shares: [0, 40],
      liquidity: 100,
      pool: initialPool(100),
      active: true,
      resolved: false,
      voided: false,
      proposalId: 'prop-1',
      branch: 'approved',
    },
    {
      id: 'mkt-decl',
      workspaceId: WS,
      metricId: 'metric-1',
      metricName: 'Weekly active verified traders',
      targetDate: '2030-06',
      rangeMin: 0,
      rangeMax: 50,
      shares: [0, 0],
      liquidity: 100,
      pool: initialPool(100),
      active: true,
      resolved: false,
      voided: false,
      proposalId: 'prop-1',
      branch: 'declined',
    },
  ]);
}

/** More contracts, each with its own priced pair, so size claims mean something. */
async function addContracts(n: number) {
  for (let i = 0; i < n; i++) {
    const id = `prop-extra-${i}`;
    await db.insert(proposals).values({
      id,
      workspaceId: WS,
      proposedBy: 'owner',
      title: `$${10 * (i + 1)}: contract number ${i}`,
      description:
        'A pitch of the length a real contract carries, several sentences of it, because that is what the brief has to hold and the index does not.',
      askUsd: 10 * (i + 1),
      status: i % 2 === 0 ? 'pending' : 'approved',
    });
    for (const [branch, shares] of [
      ['approved', [0, 30 + i]],
      ['declined', [0, 5]],
    ] as const) {
      await db.insert(markets).values({
        id: `mkt-${i}-${branch}`,
        workspaceId: WS,
        metricId: 'metric-1',
        metricName: 'Weekly active verified traders',
        targetDate: '2030-06',
        rangeMin: 0,
        rangeMax: 50,
        shares: shares as unknown as [number, number],
        liquidity: 100,
        pool: initialPool(100),
        active: true,
        resolved: false,
        voided: false,
        proposalId: id,
        branch,
      });
    }
  }
}

const index = async () => renderContextIndex((await buildWorkspaceContext(WS))!);

describe('the index carries what a floor IS, never what its contracts are worth', () => {
  test('no priced impact reaches him unasked', async () => {
    const md = await index();
    // The pair prices 32.98 against 25; neither may appear, nor the words the
    // full brief uses to introduce them.
    expect(md).not.toMatch(/Priced impact/);
    expect(md).not.toMatch(/if approved/);
    expect(md).not.toContain('32.98');
  });

  test('a contract is one line: what it is, what it costs, where it stands', async () => {
    const md = await index();
    expect(md).toContain('$300: Post a Manifold market');
    expect(md).toContain('approved');
    expect(md).toContain('prop-1');
    // The pitch and the conversation are a fetch away, not a paragraph here.
    expect(md).not.toContain('A LONG PITCH');
    expect(md).not.toContain('A COMMENT');
  });

  test('the floor itself is still handed over whole', async () => {
    const md = await index();
    expect(md).toContain('This platform, running on itself.');
    expect(md).toContain('I approve on the number, or I say why not.');
    expect(md).toContain('Weekly active verified traders');
    expect(md).toContain('Distinct verified participants');
    expect(md).toContain('Trader rewards shipped');
    expect(md).toContain('Revenue is Steam developer share');
  });

  test('an open market keeps its price, because that is the floor, not a contract', async () => {
    const md = await index();
    expect(md).toMatch(/market says/);
  });

  test('he is told the three paths by name, so he never has to guess where numbers live', async () => {
    const md = await index();
    expect(md).toContain('GET /api/marketplace/telarchy');
    expect(md).toContain('GET /api/proposals/');
    expect(md).toContain('/context');
  });

  test('the index is a fraction of the brief once a floor has real contracts', async () => {
    // A one-contract floor proves nothing: the index carries a fixed block
    // naming the endpoints, so it can be longer than a toy brief. What has to
    // hold is that it stops growing with the priced matrix, which is the part
    // that made the real Telarchy brief 46KB.
    await addContracts(12);
    const ctx = (await buildWorkspaceContext(WS))!;
    const index = renderContextIndex(ctx).length;
    const brief = renderContextMarkdown(ctx).length;
    expect(index).toBeLessThan(brief * 0.4);
  });
});

describe('the endpoint an outside agent reads is unchanged', () => {
  test('GET /context still carries every priced impact', async () => {
    const res = await request(app).get(`/api/marketplace/${WS}/context?format=md`);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Priced impact/);
    expect(res.text).toContain('A LONG PITCH');
  });
});

describe('the floor hands Otto the index, not the brief', () => {
  test('the system turn is the index', async () => {
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    const bodies: any[] = [];
    global.fetch = (async (url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 },
        }),
        text: async () => '',
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await request(app).post(`/api/marketplace/${WS}/ask`).send({ question: 'what is worth approving?' });
    const system = bodies[0].messages[0].content;
    expect(system).toContain('$300: Post a Manifold market');
    expect(system).not.toMatch(/Priced impact/);
    expect(system).not.toContain('A LONG PITCH');
  });
});

/**
 * The prompt has to describe the payload the route actually sends. It said
 * "every contract with its priced impact" for as long as that was true and
 * for one commit after it stopped being true, which is the belief that keeps
 * him from looking: an assistant told it is already holding the number does
 * not go and fetch it.
 */
describe('the prompt describes what he is actually holding', () => {
  const systemTurn = async () => {
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    const bodies: any[] = [];
    global.fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 },
        }),
        text: async () => '',
      } as unknown as Response;
    }) as unknown as typeof fetch;
    await request(app).post(`/api/marketplace/${WS}/ask`).send({ question: 'anything' });
    return bodies[0].messages[0].content as string;
  };

  test('it never promises him a priced impact he was not given', async () => {
    const system = await systemTurn();
    expect(system).not.toMatch(/every contract with its priced impact/i);
  });

  test('it says the contracts are a list and the prices are a call away', async () => {
    const system = await systemTurn();
    expect(system).toMatch(/titles?[^.]*\bno prices?\b|no prices?[^.]*\btitles?\b/i);
    expect(system).toMatch(/call_api|go and read|fetch/i);
  });

  test('"I could not find it" is only honest after he has looked', async () => {
    const system = await systemTurn();
    // The old rule stopped at the brief and the data room, which let him
    // decline a question the API and the web could both have answered.
    expect(system).toMatch(/search_web/);
    expect(system).not.toMatch(/If neither the brief nor the data room has it/i);
  });
});
