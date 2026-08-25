/**
 * GET /api/predictions/markets ?status={open|closed|resolved|voided|all} filter.
 *
 * Default flipped 2026-05-18: a bare list returns only `status=open` markets
 * so participant agents stop trying to trade closed / voided rows. Legacy
 * ?active and ?includeResolved still work when ?status is absent. Voided
 * markets are excluded everywhere unless explicitly asked for.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, markets, metrics, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { toUnits } from '../lib/validation';
import { getMarkets } from '../services/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-status';
const OWNER = 'owner-status';
const METRIC = 'metric-status';
const OPEN = 'mkt-open';
const CLOSED = 'mkt-closed';
const RESOLVED = 'mkt-resolved';
const VOIDED = 'mkt-voided';

async function seed() {
  await db.insert(workspaces).values({
    id: WS,
    name: 'Status Filter',
    createdBy: OWNER,
    visibility: 'private',
  });
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-owner-status', balance: toUnits(0) });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Steam units',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values([
    {
      id: OPEN,
      workspaceId: WS,
      metricId: METRIC,
      metricName: 'Steam units',
      targetDate: '2028',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 10,
      pool: initialPool(10),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
    },
    {
      id: CLOSED,
      workspaceId: WS,
      metricId: METRIC,
      metricName: 'Steam units',
      targetDate: '2027',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 10,
      pool: initialPool(10),
      active: false,
      resolved: false,
      voided: false,
      proposalId: null,
    },
    {
      id: RESOLVED,
      workspaceId: WS,
      metricId: METRIC,
      metricName: 'Steam units',
      targetDate: '2026',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 10,
      pool: initialPool(10),
      active: false,
      resolved: true,
      voided: false,
      proposalId: null,
    },
    {
      id: VOIDED,
      workspaceId: WS,
      metricId: METRIC,
      metricName: 'Steam units',
      targetDate: '2029',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 10,
      pool: initialPool(10),
      active: true,
      resolved: false,
      voided: true,
      proposalId: null,
    },
  ]);
}

describe('getMarkets status filter', () => {
  test('default returns only open markets (no closed, no resolved, no voided)', async () => {
    await seed();
    const rows = await getMarkets({}, undefined, WS);
    expect(rows.map(r => r.id)).toEqual([OPEN]);
  });

  test('status="closed" returns only TP-deactivated, sell-only markets', async () => {
    await seed();
    const rows = await getMarkets({ status: 'closed' }, undefined, WS);
    expect(rows.map(r => r.id)).toEqual([CLOSED]);
  });

  test('status="resolved" returns only resolved markets', async () => {
    await seed();
    const rows = await getMarkets({ status: 'resolved' }, undefined, WS);
    expect(rows.map(r => r.id)).toEqual([RESOLVED]);
  });

  test('status="voided" returns only voided markets', async () => {
    await seed();
    const rows = await getMarkets({ status: 'voided' }, undefined, WS);
    expect(rows.map(r => r.id)).toEqual([VOIDED]);
  });

  test('status="all" returns every market regardless of state', async () => {
    await seed();
    const rows = await getMarkets({ status: 'all' }, undefined, WS);
    expect(rows.map(r => r.id).sort()).toEqual([OPEN, CLOSED, RESOLVED, VOIDED].sort());
  });

  test('legacy ?active=true matches the new open default', async () => {
    await seed();
    const rows = await getMarkets({ active: true }, undefined, WS);
    expect(rows.map(r => r.id)).toEqual([OPEN]);
  });

  test('legacy ?active=false returns closed markets only (voided still excluded)', async () => {
    await seed();
    const rows = await getMarkets({ active: false }, undefined, WS);
    expect(rows.map(r => r.id)).toEqual([CLOSED]);
  });

  test('legacy ?includeResolved=true keeps the prior shape minus voided', async () => {
    await seed();
    const rows = await getMarkets({ includeResolved: true }, undefined, WS);
    expect(rows.map(r => r.id).sort()).toEqual([OPEN, CLOSED, RESOLVED].sort());
  });

  test('?includeVoided=true opts voided rows back in (legacy mode, no active filter)', async () => {
    // Legacy mode (no ?status) mirrors the historical pre-flip shape: when a
    // legacy flag is set, we trust the caller and don't auto-pin active state.
    // includeVoided=true alone returns active + inactive + voided, still
    // excluding resolved since includeResolved was not set.
    await seed();
    const rows = await getMarkets({ includeVoided: true }, undefined, WS);
    expect(rows.map(r => r.id).sort()).toEqual([OPEN, CLOSED, VOIDED].sort());
  });

  test('?status overrides legacy flags when both are passed', async () => {
    await seed();
    const rows = await getMarkets({ status: 'open', includeResolved: true, includeVoided: true }, undefined, WS);
    expect(rows.map(r => r.id)).toEqual([OPEN]);
  });
});
