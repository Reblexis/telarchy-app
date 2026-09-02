/**
 * Visibility proposal on GET /api/agents/:idOrNickname/public.
 *
 * Stats and activeWorkspaces stay aggregated over public-visibility workspaces
 * (the documented privacy contract shared with /api/leaderboard). The detail
 * fields (openPositions, recentTrades) expand to whatever workspaces the
 * caller can read.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  const realCaps = require('../middleware/capabilities');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    authMiddleware: (_req: any, _res: any, next: any) => next(),
    optionalAuthMiddleware: async (req: any, _res: any, next: any) => {
      const agentId = req.headers['x-test-agent-id'];
      if (agentId) {
        req.auth = {
          agentId,
          uid: undefined,
          workspaceId: req.headers['x-workspace-id'] ?? '',
          capabilities: req.headers['x-workspace-id']
            ? await realCaps.computeCapabilities({ workspaceId: req.headers['x-workspace-id'], agentId })
            : new Set(),
        };
      }
      next();
    },
    getAuthWorkspaceMemberships: async (info: { uid?: string; agentId?: string }) => {
      if (!info.agentId) return [];
      const { getParticipantWorkspaceMemberships } = require('../lib/participants');
      return getParticipantWorkspaceMemberships(info.agentId);
    },
  };
});

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, permissionGroups, positions, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
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

const PROFILE_OWNER = 'kai';
const PUBLIC_WS_OWNER = 'creator-public';
const PRIVATE_WS_OWNER = 'creator-private';
const PRIVATE_VIEWER = 'viewer';
const PUBLIC_WS = 'ws-public-profile';
const PRIVATE_WS = 'ws-private-profile';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

async function seed() {
  await db.insert(agents).values([
    { id: PROFILE_OWNER, apiKeyHash: 'h-kai', balance: toUnits(1000) },
    { id: PUBLIC_WS_OWNER, apiKeyHash: 'h-cpub', balance: toUnits(0) },
    { id: PRIVATE_WS_OWNER, apiKeyHash: 'h-cprv', balance: toUnits(0) },
    { id: PRIVATE_VIEWER, apiKeyHash: 'h-view', balance: toUnits(0) },
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  await provisionWorkspace(db as any, {
    wsId: PUBLIC_WS,
    name: 'Public',
    createdBy: PUBLIC_WS_OWNER,
    ownerAgentId: PUBLIC_WS_OWNER,
    visibility: 'public',
  });
  await provisionWorkspace(db as any, {
    wsId: PRIVATE_WS,
    name: 'Private',
    createdBy: PRIVATE_WS_OWNER,
    ownerAgentId: PRIVATE_WS_OWNER,
    visibility: 'private',
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Make profile owner a trader in both workspaces. Viewer is a trader in the
  // private workspace only.
  for (const ws of [PUBLIC_WS, PRIVATE_WS]) {
    const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, ws));
    const trader = groups.find(g => g.type === 'trader')!;
    const member = ws === PRIVATE_WS ? [PROFILE_OWNER, PRIVATE_VIEWER] : [PROFILE_OWNER];
    await db.update(permissionGroups).set({ memberIds: member }).where(eq(permissionGroups.id, trader.id));
  }

  await db.insert(metrics).values([
    { id: 'metric-public', workspaceId: PUBLIC_WS, name: 'Pub', value: 0, formula: '0', marketRangeMax: 100 },
    { id: 'metric-private', workspaceId: PRIVATE_WS, name: 'Priv', value: 0, formula: '0', marketRangeMax: 100 },
  ]);
  await db.insert(markets).values([
    {
      id: 'mkt-public',
      workspaceId: PUBLIC_WS,
      metricId: 'metric-public',
      metricName: 'Pub',
      targetDate: '2026-12',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 10,
      pool: initialPool(10),
      active: true,
      resolved: false,
      voided: false,
    },
    {
      id: 'mkt-private',
      workspaceId: PRIVATE_WS,
      metricId: 'metric-private',
      metricName: 'Priv',
      targetDate: '2026-12',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 10,
      pool: initialPool(10),
      active: true,
      resolved: false,
      voided: false,
    },
  ]);

  // One position + trade in each workspace.
  const now = new Date();
  await db.insert(positions).values([
    {
      id: 'pos-pub',
      agentId: PROFILE_OWNER,
      workspaceId: PUBLIC_WS,
      marketId: 'mkt-public',
      direction: 'higher',
      shares: 5,
      totalCost: 25,
    },
    {
      id: 'pos-prv',
      agentId: PROFILE_OWNER,
      workspaceId: PRIVATE_WS,
      marketId: 'mkt-private',
      direction: 'lower',
      shares: 3,
      totalCost: 15,
    },
  ]);
  await db.insert(trades).values([
    {
      id: 't-pub-1',
      agentId: PROFILE_OWNER,
      workspaceId: PUBLIC_WS,
      marketId: 'mkt-public',
      direction: 'higher',
      shares: 5,
      cost: 25,
      createdAt: now,
    },
    {
      id: 't-prv-1',
      agentId: PROFILE_OWNER,
      workspaceId: PRIVATE_WS,
      marketId: 'mkt-private',
      direction: 'lower',
      shares: 3,
      cost: 15,
      createdAt: now,
    },
  ]);
}

describe('GET /api/agents/:idOrNickname/public visibility', () => {
  test('anonymous viewer sees only public-workspace positions and trades', async () => {
    await seed();
    const res = await request(app).get(`/api/agents/${PROFILE_OWNER}/public`);
    expect(res.status).toBe(200);
    expect(res.body.openPositions).toHaveLength(1);
    expect(res.body.openPositions[0]).toMatchObject({ workspaceId: PUBLIC_WS, marketId: 'mkt-public' });
    expect(res.body.recentTrades).toHaveLength(1);
    expect(res.body.recentTrades[0]).toMatchObject({ workspaceId: PUBLIC_WS, marketId: 'mkt-public' });
    expect(res.body.activeWorkspaces.map((w: { id: string }) => w.id)).toEqual([PUBLIC_WS]);
  });

  test('authenticated viewer with read on a private workspace sees that workspace too', async () => {
    await seed();
    const res = await request(app)
      .get(`/api/agents/${PROFILE_OWNER}/public`)
      .set('X-Test-Agent-Id', PRIVATE_VIEWER)
      .set('X-Workspace-Id', PRIVATE_WS);
    expect(res.status).toBe(200);
    const positionWsIds = res.body.openPositions.map((p: { workspaceId: string }) => p.workspaceId).sort();
    expect(positionWsIds).toEqual([PRIVATE_WS, PUBLIC_WS].sort());
    const tradeWsIds = res.body.recentTrades.map((t: { workspaceId: string }) => t.workspaceId).sort();
    expect(tradeWsIds).toEqual([PRIVATE_WS, PUBLIC_WS].sort());
    // activeWorkspaces stays public-only on purpose (privacy contract).
    expect(res.body.activeWorkspaces.map((w: { id: string }) => w.id)).toEqual([PUBLIC_WS]);
  });

  test('authenticated viewer who is not a member of the private workspace gets no extra visibility', async () => {
    await seed();
    // Outsider has an identity but isn't a member of PRIVATE_WS.
    await db.insert(agents).values({ id: 'outsider', apiKeyHash: 'h-out', balance: toUnits(0) });
    const res = await request(app).get(`/api/agents/${PROFILE_OWNER}/public`).set('X-Test-Agent-Id', 'outsider');
    expect(res.status).toBe(200);
    expect(res.body.openPositions.map((p: { workspaceId: string }) => p.workspaceId)).toEqual([PUBLIC_WS]);
    expect(res.body.recentTrades.map((t: { workspaceId: string }) => t.workspaceId)).toEqual([PUBLIC_WS]);
  });

  test('conditional markets get status "conditional" and surface proposalId', async () => {
    await seed();
    // Mark mkt-public as conditional (proposalId set, otherwise still live).
    await db.update(markets).set({ proposalId: 'prop-123', branch: 'approved' }).where(eq(markets.id, 'mkt-public'));
    const res = await request(app).get(`/api/agents/${PROFILE_OWNER}/public`);
    const pub = res.body.openPositions.find((p: { marketId: string }) => p.marketId === 'mkt-public');
    expect(pub.status).toBe('conditional');
    expect(pub.proposalId).toBe('prop-123');
  });

  test('position status reflects market state (open / closed / resolved)', async () => {
    await seed();
    // Public market: still open. Private market: close it (active=false, unresolved).
    await db.update(markets).set({ active: false }).where(eq(markets.id, 'mkt-private'));
    const res = await request(app)
      .get(`/api/agents/${PROFILE_OWNER}/public`)
      .set('X-Test-Agent-Id', PRIVATE_VIEWER)
      .set('X-Workspace-Id', PRIVATE_WS);
    const byMarket = new Map<string, string>(
      res.body.openPositions.map((p: { marketId: string; status: string }) => [p.marketId, p.status]),
    );
    expect(byMarket.get('mkt-public')).toBe('open');
    expect(byMarket.get('mkt-private')).toBe('closed');
  });

  test('voided markets do not surface as open positions', async () => {
    await seed();
    await db.update(markets).set({ voided: true, active: false }).where(eq(markets.id, 'mkt-public'));
    const res = await request(app).get(`/api/agents/${PROFILE_OWNER}/public`);
    expect(res.body.openPositions).toEqual([]);
  });

  test('open positions are filtered to shares > 0', async () => {
    await seed();
    await db.update(positions).set({ shares: 0 }).where(eq(positions.marketId, 'mkt-public'));
    const res = await request(app).get(`/api/agents/${PROFILE_OWNER}/public`);
    expect(res.body.openPositions).toEqual([]);
    // Trade history survives even if the position has been fully unwound.
    expect(res.body.recentTrades).toHaveLength(1);
  });

  test('stats stay aggregated over public workspaces only, regardless of viewer', async () => {
    await seed();
    // Resolve the private market in profile owner's favour. If stats expanded
    // to the viewer's scope, totalEarnings and resolvedMarkets would change
    // between anon and authenticated viewer. They must not.
    await db.update(markets).set({ resolved: true, actualValue: 0 }).where(eq(markets.id, 'mkt-private'));

    const anon = await request(app).get(`/api/agents/${PROFILE_OWNER}/public`);
    const authed = await request(app)
      .get(`/api/agents/${PROFILE_OWNER}/public`)
      .set('X-Test-Agent-Id', PRIVATE_VIEWER)
      .set('X-Workspace-Id', PRIVATE_WS);

    expect(anon.body.stats).toEqual(authed.body.stats);
  });
});

// Cleanup: silence the workspaces import (used implicitly via provisionWorkspace).
void workspaces;
