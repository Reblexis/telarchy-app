/**
 * A participant's public profile lists the credit transfers they sent or
 * received (docs/ui-conventions.md, "The participant profile", Transfers):
 * they count in the season score (docs/seasons.md, "Credits transferred
 * between participants count"), and a number that moves a public standing
 * has to be readable on the public record that explains it. Owner ask
 * 2026-09-16: "make sure to show them in personal logs as well the transfers
 * on profile".
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    optionalAuthMiddleware: async (_req: any, _res: any, next: any) => next(),
    getAuthWorkspaceMemberships: async () => [],
  };
});

import express from 'express';
import request from 'supertest';
import { agents, creditLedger, creditTransfers } from '../db/schema';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { agentsRouter } from '../routes/agents';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/agents', agentsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: (err as Error).message ?? 'Internal error' });
});

const ME = 'agent-me-pt';
const OTHER = 'agent-other-pt';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: ME, apiKeyHash: 'h-me-pt', balance: toUnits(100), nickname: 'me' },
    { id: OTHER, apiKeyHash: 'h-other-pt', balance: toUnits(100), nickname: 'vire' },
  ]);
});

const at = (h: number) => new Date(Date.parse('2026-09-16T00:00:00Z') + h * 3600_000);

describe('GET /api/agents/:idOrNickname/public transfers', () => {
  test('lists sent and received transfers, newest first, with the counterparty named', async () => {
    await db.insert(creditTransfers).values([
      { id: 'x-1', fromAgentId: OTHER, toAgentId: ME, credits: 2000, memo: 'initial bankroll', createdAt: at(1) },
      { id: 'x-2', fromAgentId: ME, toAgentId: OTHER, credits: 15000, memo: '', createdAt: at(2) },
    ]);
    const res = await request(app).get(`/api/agents/${ME}/public`);
    expect(res.status).toBe(200);
    expect(res.body.transfers).toEqual([
      {
        id: 'x-2',
        direction: 'out',
        counterparty: { id: OTHER, nickname: 'vire' },
        credits: 15000,
        memo: '',
        createdAt: at(2).toISOString(),
      },
      {
        id: 'x-1',
        direction: 'in',
        counterparty: { id: OTHER, nickname: 'vire' },
        credits: 2000,
        memo: 'initial bankroll',
        createdAt: at(1).toISOString(),
      },
    ]);
  });

  test('a participant on no public floor still shows their transfers', async () => {
    // The early answer for a participant with no visible floor carries the
    // same record as the full one: who they are does not depend on floors.
    await db
      .insert(creditTransfers)
      .values([{ id: 'x-3', fromAgentId: OTHER, toAgentId: ME, credits: 5, memo: '', createdAt: at(1) }]);
    const res = await request(app).get(`/api/agents/${ME}/public`);
    expect(res.status).toBe(200);
    expect(res.body.transfers.map((t: { id: string }) => t.id)).toEqual(['x-3']);
  });

  test('the list holds the newest 20', async () => {
    await db.insert(creditTransfers).values(
      Array.from({ length: 25 }, (_, i) => ({
        id: `x-many-${i}`,
        fromAgentId: OTHER,
        toAgentId: ME,
        credits: i + 1,
        memo: '',
        createdAt: at(i),
      })),
    );
    const res = await request(app).get(`/api/agents/${ME}/public`);
    expect(res.body.transfers).toHaveLength(20);
    expect(res.body.transfers[0].credits).toBe(25);
  });

  test('a deposit is not a transfer and is not listed', async () => {
    await db.insert(creditLedger).values({
      id: 'ledger-dep',
      workspaceId: 'platform',
      agentId: ME,
      deltaUnits: toUnits(500),
      balanceAfterUnits: toUnits(600),
      reason: 'transfer_in',
      refType: 'transfer',
      refId: '0xabc',
      createdAt: at(1),
    });
    const res = await request(app).get(`/api/agents/${ME}/public`);
    expect(res.body.transfers).toEqual([]);
  });

  test('a participant with a public floor and no transfers reads an empty list, not a missing field', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await provisionWorkspace(db as any, {
      wsId: 'ws-pt',
      name: 'Floor',
      createdBy: ME,
      ownerAgentId: ME,
      visibility: 'public',
    });
    const res = await request(app).get(`/api/agents/${ME}/public`);
    expect(res.status).toBe(200);
    expect(res.body.transfers).toEqual([]);
  });
});
