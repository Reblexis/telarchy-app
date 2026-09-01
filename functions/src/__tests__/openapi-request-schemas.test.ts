/**
 * The published spec's request schemas, fired at the real routes.
 *
 * `public/openapi.json` is hand-written, and the objection to a hand-written
 * spec is that it drifts: the moment a route changes, the document that told
 * agents how to call it becomes a confident lie, and a spec that lies is worse
 * than none because generated clients trust it. The Trade schema happens to
 * name `direction` correctly today, and nothing was keeping it that way.
 *
 * So the schemas are not merely compared to a list of paths, which
 * discovery-documents.test.ts already does. A body is BUILT from the published
 * schema and sent to the handler. If the spec names a field the route does not
 * read, this fails, whatever the prose around it says.
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
        capabilities: new Set(['read', 'trade']),
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
import { apiErrorHandler } from '../lib/api-error-handler';
import { ERROR_CODES } from '../lib/error-codes';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { predictionsRouter } from '../routes/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/predictions', authMiddleware, predictionsRouter);
app.use(apiErrorHandler);

const SPEC = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'public', 'openapi.json'), 'utf8')) as {
  paths: Record<string, Record<string, { requestBody?: unknown; parameters?: unknown[] }>>;
  components: { schemas: Record<string, SchemaNode> };
};

interface SchemaNode {
  type?: string;
  enum?: unknown[];
  properties?: Record<string, SchemaNode>;
  required?: string[];
  description?: string;
  $ref?: string;
}

const WS = 'ws-spec';
const OWNER = 'agent-spec-owner';
const TRADER = 'trader-spec';
const MARKET = 'market-spec';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await seed();
});

async function seed(): Promise<void> {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-spec-owner', balance: toUnits(0) },
    { id: TRADER, apiKeyHash: 'h-spec-trader', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Spec',
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
    id: 'metric-spec',
    workspaceId: WS,
    name: 'Activation',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: 'metric-spec',
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

/** Values for schema properties the tests cannot invent, keyed by name. */
const FIXTURE: Record<string, unknown> = { marketId: MARKET, amount: 1, budgetCredits: 5, limitValue: 40 };

/** A minimal body honouring the published schema: required fields only. */
function bodyFromSchema(schema: SchemaNode, extraProps: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const props = schema.properties ?? {};
  for (const name of [...(schema.required ?? []), ...extraProps]) {
    const prop = props[name];
    if (!prop) throw new Error(`schema names "${name}" but has no property for it`);
    if (prop.enum?.length) out[name] = prop.enum[0];
    else if (name in FIXTURE) out[name] = FIXTURE[name];
    else if (prop.type === 'number' || prop.type === 'integer') out[name] = 1;
    else if (prop.type === 'boolean') out[name] = true;
    else out[name] = 'x';
  }
  return out;
}

describe('the published Trade schema is the shape the route reads', () => {
  const trade = SPEC.components.schemas.Trade;

  test('the spec still documents a Trade schema at all', () => {
    expect(trade?.properties).toBeDefined();
  });

  test('THE RULE: a directional buy built from the schema is accepted', async () => {
    // Built from the document, not from what we believe the route wants.
    const body = bodyFromSchema(trade, ['direction', 'amount']);
    const res = await request(app)
      .post('/api/predictions/trade')
      .set('X-Test-Agent-Id', TRADER)
      .set('X-Workspace-Id', WS)
      .set('Content-Type', 'application/json')
      .send(body);
    expect({ sent: body, status: res.status, error: res.body.error }).toEqual({
      sent: body,
      status: 201,
      error: undefined,
    });
  });

  test('a targetValue trade built from the schema is accepted', async () => {
    const body = { ...bodyFromSchema(trade), targetValue: 40, maxBudget: 5 };
    const res = await request(app)
      .post('/api/predictions/trade')
      .set('X-Test-Agent-Id', TRADER)
      .set('X-Workspace-Id', WS)
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(201);
  });

  test('every property the schema publishes is one the route acts on', async () => {
    // A schema property the route ignores is a promise the document cannot
    // keep. Each is sent alone with marketId and must not be rejected as an
    // unrecognised body shape.
    const names = Object.keys(trade.properties ?? {}).filter(n => n !== 'marketId');
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const body = bodyFromSchema(trade, [name]);
      // Pair the two fields that only mean something together.
      if (name === 'direction') Object.assign(body, { amount: 1 });
      if (name === 'amount' || name === 'sellShares') Object.assign(body, { direction: 'higher' });
      if (name === 'targetValue') Object.assign(body, { maxBudget: 5 });
      if (name === 'maxBudget') Object.assign(body, { targetValue: 40 });
      // dryRun modifies a trade rather than being one, so it needs a mode
      // beside it exactly as a real caller would send it.
      if (name === 'dryRun') Object.assign(body, { direction: 'higher', amount: 1 });
      const res = await request(app)
        .post('/api/predictions/trade')
        .set('X-Test-Agent-Id', TRADER)
        .set('X-Workspace-Id', WS)
        .set('Content-Type', 'application/json')
        .send(body);
      expect({ name, unrecognised: /Provide \{targetValue/.test(String(res.body.error ?? '')) }).toEqual({
        name,
        unrecognised: false,
      });
    }
  });

  test('the dry run the API now supports is in the document', async () => {
    // The spec is the thing agents generate clients from; a feature missing
    // from it does not exist as far as they are concerned.
    expect(trade.properties?.dryRun).toBeDefined();
  });
});

describe('the spec agrees with the error vocabulary', () => {
  /** Field names the schema legitimately mentions that are not error codes. */
  const NOT_CODES = new Set(['doc_url', 'error_codes']);

  test('every code-shaped token it names is a real code', () => {
    // Quoted either way: the schema's own descriptions quote examples with
    // single quotes inside a JSON string, and an example code that does not
    // exist is exactly the thing worth catching.
    const named = JSON.stringify(SPEC.components.schemas.Error ?? {});
    const invented: string[] = [];
    for (const m of named.matchAll(/['"]([a-z]+(?:_[a-z]+)+)['"]/g)) {
      const token = m[1];
      if (NOT_CODES.has(token)) continue;
      if (!(ERROR_CODES as readonly string[]).includes(token)) invented.push(token);
    }
    expect(invented).toEqual([]);
  });

  test('it describes `error` as prose and `code` as the machine-readable part', () => {
    // Getting this backwards tells every client generator to branch on the
    // sentence, which is the exact mistake the codes exist to end.
    const err = SPEC.components.schemas.Error as SchemaNode;
    expect(err.properties?.error?.type).toBe('string');
    expect(String(err.properties?.error?.description ?? '')).not.toMatch(/machine-readable/i);
    expect(err.properties?.code).toBeDefined();
    expect(String(err.properties?.code?.description ?? '')).toMatch(/machine/i);
  });
});
