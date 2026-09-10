/**
 * Nothing accumulates without a reader (docs/infra/deploy.md, "Reads are
 * bounded in the size of a workspace"): the per-proposal spawn lock row in
 * system_config is deleted when the spawn finishes, and event cleanup counts
 * what it deleted rather than returning every row. A floor posting a
 * proposal a minute left 5,760 dead lock rows a day and returned ~6k event
 * ids per cleanup run (notes/snake-load-audit-2026-09-10.md, item 14).
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { like } from 'drizzle-orm';
import { agents, events, markets, metrics, proposals, systemConfig, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { cleanupOldEvents } from '../services/events';
import { createConditionalMarkets } from '../services/proposals';
import { captureQueries, db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: 'agent-lk', apiKeyHash: 'h-lk', balance: 10_000_000 });
  await db.insert(workspaces).values({ id: WS, name: 'Lock', slug: 'lock', createdBy: 'agent-lk' });
});

const WS = 'ws-lock';

const lockRows = () =>
  db.select({ key: systemConfig.key }).from(systemConfig).where(like(systemConfig.key, 'lock:proposalMarket:%'));

describe('the spawn lock row', () => {
  test('is gone once the spawn finishes', async () => {
    await db
      .insert(metrics)
      .values({ id: 'metric-lk', workspaceId: WS, name: 'Revenue', value: 50, formula: '0', marketRangeMax: 100 });
    await db.insert(markets).values({
      id: 'mkt-lk',
      workspaceId: WS,
      metricId: 'metric-lk',
      metricName: 'Revenue',
      targetDate: '2030-12',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 10,
      pool: initialPool(10),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
    });
    await db
      .insert(proposals)
      .values({
        id: 'prop-lk',
        workspaceId: WS,
        proposedBy: 'agent-lk',
        title: 'x',
        description: '',
        status: 'pending',
      });
    const ids = await createConditionalMarkets('prop-lk', WS);
    expect(ids).toHaveLength(2);
    expect(await lockRows()).toEqual([]);
  });

  test('is gone even when the spawn throws', async () => {
    // No metrics, no baseline: the spawn still runs its lock protocol and
    // must not leave the row behind. Forced by a proposal whose workspace
    // has nothing to spawn on and a strict subsidy nobody can pay.
    await db
      .insert(proposals)
      .values({
        id: 'prop-lk-2',
        workspaceId: WS,
        proposedBy: 'agent-lk',
        title: 'x',
        description: '',
        status: 'pending',
      });
    await createConditionalMarkets('prop-lk-2', WS).catch(() => undefined);
    expect(await lockRows()).toEqual([]);
  });
});

describe('event cleanup', () => {
  test('returns the number of rows deleted without returning the rows', async () => {
    const old = new Date(Date.now() - 72 * 3600_000);
    await db.insert(events).values([
      { id: 'e-1', workspaceId: WS, type: 'proposal:created', data: {}, timestamp: old },
      { id: 'e-2', workspaceId: WS, type: 'proposal:created', data: {}, timestamp: old },
      { id: 'e-3', workspaceId: WS, type: 'proposal:created', data: {}, timestamp: old },
      { id: 'e-4', workspaceId: WS, type: 'proposal:created', data: {}, timestamp: new Date() },
      { id: 'e-5', workspaceId: 'other', type: 'proposal:created', data: {}, timestamp: old },
    ]);
    const cap = captureQueries();
    let deleted: number;
    try {
      deleted = await cleanupOldEvents(WS);
    } finally {
      cap.stop();
    }
    expect(deleted).toBe(3);
    const q = cap.queries.find(s => s.startsWith('delete from "events"'));
    expect(q).toBeDefined();
    expect(q).not.toMatch(/returning/i);
    expect((await db.select({ id: events.id }).from(events)).map(r => r.id).sort()).toEqual(['e-4', 'e-5']);
  });

  test('nothing to delete is zero', async () => {
    expect(await cleanupOldEvents(WS)).toBe(0);
  });
});
