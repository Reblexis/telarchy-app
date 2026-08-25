/**
 * GET /api/predictions/markets ?kind={baseline|conditional|all} filter.
 *
 * Conditional markets (markets.proposal_id set) were always hidden from the
 * baseline list to keep the markets tab focused on live proposals. The kind
 * filter opts in: a viewer can now discover conditional markets from the
 * markets tab and click into the proposal lens. Baseline stays the default
 * so the existing UX doesn't shift under anyone's feet.
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

const WS = 'ws-kind';
const OWNER = 'owner-kind';
const METRIC = 'metric-kind';
const BASELINE_MARKET = 'mkt-baseline';
const CONDITIONAL_MARKET_A = 'mkt-cond-a';
const CONDITIONAL_MARKET_B = 'mkt-cond-b';

async function seed() {
  await db.insert(workspaces).values({
    id: WS,
    name: 'Kind Filter',
    createdBy: OWNER,
    visibility: 'private',
  });
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-owner', balance: toUnits(0) });
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
      id: BASELINE_MARKET,
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
      id: CONDITIONAL_MARKET_A,
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
      proposalId: 'prop-1',
      branch: 'approved',
    },
    {
      id: CONDITIONAL_MARKET_B,
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
      proposalId: 'prop-2',
      branch: 'approved',
    },
  ]);
}

describe('getMarkets kind filter', () => {
  test('default (no kind, no proposalId) returns baseline only', async () => {
    await seed();
    const rows = await getMarkets({}, undefined, WS);
    expect(rows.map(r => r.id)).toEqual([BASELINE_MARKET]);
  });

  test('kind="baseline" matches the default', async () => {
    await seed();
    const rows = await getMarkets({ kind: 'baseline' }, undefined, WS);
    expect(rows.map(r => r.id)).toEqual([BASELINE_MARKET]);
  });

  test('kind="conditional" returns conditional markets across all proposals', async () => {
    await seed();
    const rows = await getMarkets({ kind: 'conditional' }, undefined, WS);
    expect(rows.map(r => r.id).sort()).toEqual([CONDITIONAL_MARKET_A, CONDITIONAL_MARKET_B].sort());
    for (const r of rows) expect(r.proposalId).toBeTruthy();
  });

  test('kind="all" returns baseline plus every conditional market', async () => {
    await seed();
    const rows = await getMarkets({ kind: 'all' }, undefined, WS);
    expect(rows.map(r => r.id).sort()).toEqual([BASELINE_MARKET, CONDITIONAL_MARKET_A, CONDITIONAL_MARKET_B].sort());
  });

  test('explicit proposalId still pins to that proposal regardless of kind', async () => {
    await seed();
    const rows = await getMarkets({ proposalId: 'prop-1', kind: 'all' }, undefined, WS);
    expect(rows.map(r => r.id)).toEqual([CONDITIONAL_MARKET_A]);
  });
});
