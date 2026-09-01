/**
 * The prompts a person copies out of the agent panel are instructions to a
 * machine, so every API call written into them is a contract this suite has to
 * hold, exactly like a route's own tests.
 *
 * The 2026-09-01 DX review found `traderAgentPrompt` telling agents to send
 * `{ marketId, outcome: "HIGHER" | "LOWER", amount }` while the route has only
 * ever accepted `direction: "higher" | "lower"`, so the first write of every
 * agent handed that prompt returned 400. Nothing caught it for the same reason
 * it shipped: `AgentDoors.test.tsx` asserts the copy button copies
 * `traderAgentPrompt(...)`, which compares the function to itself and is true
 * whatever the function says.
 *
 * So this test does not restate the call. It reads `src/lib/agent-prompt.ts`
 * as text, parses out the literal request the user is told to send, and fires
 * THAT at the real trade route. A test that re-derives the body from the same
 * belief that produced the bug would pass while the bug is live.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authMiddleware: (req: any, _res: any, next: any) => {
      req.auth = {
        agentId: req.headers['x-test-agent-id'],
        workspaceId: req.headers['x-workspace-id'],
        capabilities: new Set(['read', 'trade', 'manage']),
      };
      next();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
  };
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, permissionGroups } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/predictions', authMiddleware, predictionsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  const extra = err instanceof AppError && err.extra ? err.extra : {};
  res.status(status).json({ error: err.message, ...extra });
});

/** The file the copy button reads from. Parsed as text, on purpose. */
const PROMPT_SRC = join(__dirname, '..', '..', '..', 'src', 'lib', 'agent-prompt.ts');

const WS = 'ws-prompt-contract';
const OWNER = 'agent-prompt-owner';
const TRADER = 'agent-prompt-trader';
const METRIC = 'metric-prompt-contract';
const MARKET = 'market-prompt-contract';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

async function seed(): Promise<void> {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-prompt-owner', balance: toUnits(0) },
    { id: TRADER, apiKeyHash: 'h-prompt-trader', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Prompt Contract',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, WS));
  const trader = groups.find(g => g.type === 'trader')!;
  await db
    .update(permissionGroups)
    .set({ memberIds: [TRADER] })
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

/**
 * Pull the body the prompt tells the agent to send on a given path.
 *
 * The prompts write bodies in TypeScript object shorthand, e.g.
 *   POST /api/predictions/trade { marketId, direction: "higher" | "lower", amount }
 * so a key can appear bare (fill it from the fixture below), with a union of
 * string literals (take the first, which is what an agent reading a union
 * does), or with a plain literal value.
 */
function documentedBody(src: string, method: string, path: string): Record<string, unknown> {
  const line = src.split('\n').find(l => l.includes(`${method} ${path}`) && l.includes('{'));
  if (!line) throw new Error(`agent-prompt.ts documents no body for ${method} ${path}`);
  const start = line.indexOf('{', line.indexOf(path));
  const end = line.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`could not read the body braces on: ${line.trim()}`);
  const inner = line.slice(start + 1, end);

  /** Values for keys the prompt writes bare, by the name it writes. */
  const fill: Record<string, unknown> = { marketId: MARKET, amount: 1 };

  const body: Record<string, unknown> = {};
  for (const part of inner
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)) {
    const colon = part.indexOf(':');
    if (colon < 0) {
      const key = part.trim();
      if (!(key in fill)) throw new Error(`prompt documents a bare key this test cannot fill: "${key}"`);
      body[key] = fill[key];
      continue;
    }
    const key = part.slice(0, colon).trim();
    const rhs = part.slice(colon + 1).trim();
    const literal = rhs.match(/"([^"]*)"/);
    body[key] = literal ? literal[1] : rhs;
  }
  return body;
}

describe('the API calls written into the copied agent prompts', () => {
  test('the trade call the trader prompt hands out is accepted by the trade route', async () => {
    await seed();
    const src = readFileSync(PROMPT_SRC, 'utf8');
    const body = documentedBody(src, 'POST', '/api/predictions/trade');

    const res = await request(app)
      .post('/api/predictions/trade')
      .set('X-Test-Agent-Id', TRADER)
      .set('X-Workspace-Id', WS)
      .set('Content-Type', 'application/json')
      .send(body);

    // 201 or nothing. A 400 here means we are telling every agent that copies
    // this prompt to send a body the route cannot read.
    expect({ status: res.status, sent: body, got: res.body }).toEqual({
      status: 201,
      sent: body,
      got: expect.objectContaining({ shares: expect.any(Number) }),
    });
  });

  test('the trade call names a direction the route accepts', async () => {
    const src = readFileSync(PROMPT_SRC, 'utf8');
    const body = documentedBody(src, 'POST', '/api/predictions/trade');
    // Named after the rule: the route reads `direction`, lowercase, and has
    // never accepted an alias (routes/predictions.ts, the three trade modes).
    expect(Object.keys(body)).toContain('direction');
    expect(['higher', 'lower']).toContain(body.direction);
  });
});
