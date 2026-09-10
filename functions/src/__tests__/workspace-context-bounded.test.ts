/**
 * The workspace brief reads bounded history (docs/infra/deploy.md, "Reads
 * are bounded in the size of a workspace"): the metric log query is windowed
 * to BRIEF_HISTORY_DAYS, the first reading day is its own aggregate, and the
 * 25 proposals' markets come back in one query instead of 25 parallel ones
 * against a four-connection pool (notes/snake-load-audit-2026-09-10.md, item
 * 12).
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, markets, metricLogs, metrics, permissionGroups, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { BRIEF_HISTORY_DAYS, buildWorkspaceContext } from '../services/workspace-context';
import { captureQueries, db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await seed();
});

const WS = 'ws-ctxb';
const OLD_DAY = '2020-03-04';

async function seed() {
  await db.insert(agents).values({ id: 'agent-cb', apiKeyHash: 'h-cb', balance: 0, nickname: 'cb' });
  await db
    .insert(workspaces)
    .values({ id: WS, name: 'Brief', slug: 'brief', createdBy: 'agent-cb', visibility: 'public' });
  await db.insert(permissionGroups).values({
    id: 'grp-cb',
    workspaceId: WS,
    name: 'Public',
    type: 'public',
    capabilities: ['read'],
    memberIds: [],
    sourcePermissions: {},
  });
  await db
    .insert(metrics)
    .values({ id: 'metric-cb', workspaceId: WS, name: 'Revenue', value: 50, marketRangeMax: 100 });
  const recent = new Date(Date.now() - 2 * 86_400_000);
  await db.insert(metricLogs).values([
    // Years before the window: the day the workspace started running here.
    {
      id: 'log-old',
      workspaceId: WS,
      metricId: 'metric-cb',
      metricName: 'Revenue',
      value: 1,
      timestamp: new Date(`${OLD_DAY}T12:00:00.000Z`),
    },
    { id: 'log-recent', workspaceId: WS, metricId: 'metric-cb', metricName: 'Revenue', value: 50, timestamp: recent },
  ]);
  const base = {
    workspaceId: WS,
    metricId: 'metric-cb',
    metricName: 'Revenue',
    targetDate: '2030-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0] as [number, number],
    liquidity: 10,
    pool: initialPool(10),
    active: true,
    resolved: false,
    voided: false,
  };
  await db.insert(markets).values({ ...base, id: 'mkt-base', proposalId: null, branch: null });
  const props = Array.from({ length: 25 }, (_, i) => ({
    id: `p-${i}`,
    workspaceId: WS,
    number: i + 1,
    proposedBy: 'agent-cb',
    title: `Proposal ${i}`,
    description: '',
    status: 'pending',
    createdAt: new Date(Date.now() - i * 60_000),
  }));
  await db.insert(proposals).values(props);
  await db.insert(markets).values(
    props.flatMap(p => [
      { ...base, id: `m-${p.id}-a`, proposalId: p.id, branch: 'approved' },
      { ...base, id: `m-${p.id}-d`, proposalId: p.id, branch: 'declined' },
    ]),
  );
}

describe('THE RULE: the brief is bounded in the size of the workspace', () => {
  let queries: string[] = [];
  let ctx: Awaited<ReturnType<typeof buildWorkspaceContext>>;

  beforeEach(async () => {
    const cap = captureQueries();
    try {
      ctx = await buildWorkspaceContext(WS);
    } finally {
      cap.stop();
    }
    queries = cap.queries;
  });

  test('the metric log query is windowed to BRIEF_HISTORY_DAYS', () => {
    expect(BRIEF_HISTORY_DAYS).toBe(120);
    const q = queries.find(s => s.includes('from metric_logs') && s.includes('distinct on'));
    expect(q).toBeDefined();
    expect(q).toMatch(/timestamp >= /);
    // The old reading is outside the window; the recent one is the history.
    expect(ctx?.metrics[0].history.map(h => h.value)).toEqual([50]);
  });

  test('the first reading day survives the window', () => {
    expect(ctx?.runningSince).toBe(OLD_DAY);
  });

  test('25 proposals cost a constant number of market reads', () => {
    const reads = queries.filter(s => s.includes('from "markets"'));
    expect(reads.length).toBeLessThanOrEqual(4);
    expect(ctx?.contracts).toHaveLength(25);
    expect(ctx?.contracts.every(c => c.impact.length === 1)).toBe(true);
  });
});
