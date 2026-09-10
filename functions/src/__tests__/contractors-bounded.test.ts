/**
 * THE CONTRACTOR RAIL READS A BOUNDED SET OF PROPOSALS.
 *
 * `GET /api/marketplace/:workspaceId` ranks contractors over the
 * workspace's pending proposals plus its most recently posted decided ones
 * (CONTRACTOR_DECIDED_WINDOW of them), never over every approved proposal
 * the workspace ever had, and it never lists their ids into a second query.
 * The Snake workspace approves 1,440 proposals a day, and the audit
 * (telarchy umbrella, notes/snake-load-audit-2026-09-10.md, item 2) found
 * the floor poll and the home page loading all of them and their markets
 * every fifteen seconds, with an `IN (<every id>)` list that throws past
 * Postgres's parameter cap around day 45 and takes the home page with it.
 *
 * A decided proposal is valued on `proposals.decidedPricing` (owner ruling
 * 2026-09-04), so its books are not needed at all; only a PENDING
 * proposal's live pair is read, and by join rather than by id list.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, permissionGroups, proposals } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { CONTRACTOR_DECIDED_WINDOW, marketplaceRouter } from '../routes/marketplace';
import { captureQueries, largest, widest } from './harness/query-log';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-bounded';
const OWNER = 'owner-bounded';
const OLDEST = 'contractor-oldest';
const PROLIFIC = 'contractor-prolific';
const PATIENT = 'contractor-patient';
const HERO = 'metric-bounded';
const T0 = Date.parse('2026-08-01T00:00:00Z');

function book(id: string, proposalId: string | null, branch: 'approved' | 'declined' | null, shares: [number, number]) {
  return {
    id,
    workspaceId: WS,
    metricId: HERO,
    metricName: 'Revenue',
    targetDate: '2028',
    rangeMin: 0,
    rangeMax: 100,
    shares,
    liquidity: 100,
    pool: initialPool(100),
    active: true,
    resolved: false,
    voided: false,
    proposalId,
    branch,
  };
}

/**
 * One old approved proposal by OLDEST, then `decided` newer approved ones by
 * PROLIFIC, and one pending proposal by PATIENT older than everything. Every
 * decided proposal carries its recorded pair (+5 for OLDEST, +1 each for
 * PROLIFIC) on the hero metric.
 */
async function seed(decided: number) {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-o', balance: 0 },
    { id: OLDEST, apiKeyHash: 'h-1', balance: 0, nickname: 'oldest' },
    { id: PROLIFIC, apiKeyHash: 'h-2', balance: 0, nickname: 'prolific' },
    { id: PATIENT, apiKeyHash: 'h-3', balance: 0, nickname: 'patient' },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Bounded',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  const [publicGroup] = await db
    .select()
    .from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, WS), eq(permissionGroups.type, 'public')));
  await db
    .update(permissionGroups)
    .set({ capabilities: ['read'] })
    .where(eq(permissionGroups.id, publicGroup.id));
  await db
    .insert(metrics)
    .values({ id: HERO, workspaceId: WS, name: 'Revenue', value: 50, formula: '0', marketRangeMax: 100 });

  const recorded = (delta: number) => [
    { metricId: HERO, targetDate: '2028', approvedConsensus: 50 + delta, declinedConsensus: 50 },
  ];
  const rows: Array<typeof proposals.$inferInsert> = [
    {
      id: 'prop-patient',
      workspaceId: WS,
      proposedBy: PATIENT,
      title: 'Still waiting',
      description: '',
      status: 'pending',
      createdAt: new Date(T0 - 60_000),
    },
    {
      id: 'prop-oldest',
      workspaceId: WS,
      proposedBy: OLDEST,
      title: 'The first job',
      description: '',
      status: 'approved',
      askUsd: 20,
      createdAt: new Date(T0),
      resolvedAt: new Date(T0 + 60_000),
      decidedPricing: recorded(5),
    },
  ];
  for (let i = 0; i < decided; i++) {
    rows.push({
      id: `prop-prolific-${i}`,
      workspaceId: WS,
      proposedBy: PROLIFIC,
      title: `Job ${i}`,
      description: '',
      status: 'approved',
      askUsd: 1,
      createdAt: new Date(T0 + (i + 1) * 120_000),
      resolvedAt: new Date(T0 + (i + 1) * 120_000 + 60_000),
      decidedPricing: recorded(1),
    });
  }
  for (let i = 0; i < rows.length; i += 200) await db.insert(proposals).values(rows.slice(i, i + 200));

  await db.insert(markets).values([
    // The hero baseline, so impact has a unit.
    book('mkt-baseline', null, null, [0, 0]),
    // The pending proposal's live pair, priced approved above declined.
    book('mkt-patient-appr', 'prop-patient', 'approved', [0, 10]),
    book('mkt-patient-decl', 'prop-patient', 'declined', [0, 0]),
  ]);
}

type Row = { id: string; jobs: number; pendingJobs: number; pricedJobs: number; impact: number | null };

async function rail(): Promise<Row[]> {
  const res = await request(app).get(`/api/marketplace/${WS}`);
  expect(res.status).toBe(200);
  return res.body.topContractors as Row[];
}

describe('THE CONTRACTOR RAIL READS A BOUNDED SET OF PROPOSALS', () => {
  test('the window is two hundred decided proposals', () => {
    expect(CONTRACTOR_DECIDED_WINDOW).toBe(200);
  });

  test('a decided proposal older than the window no longer scores; a pending one always does', async () => {
    await seed(CONTRACTOR_DECIDED_WINDOW);
    const rows = await rail();
    const byId = new Map(rows.map(r => [r.id, r]));
    // PROLIFIC's two hundred fill the window; OLDEST's job is the 201st
    // decided proposal counting back, so it is outside it.
    expect(byId.get(PROLIFIC)).toMatchObject({
      jobs: CONTRACTOR_DECIDED_WINDOW,
      pricedJobs: CONTRACTOR_DECIDED_WINDOW,
    });
    expect(byId.get(PROLIFIC)!.impact).toBeCloseTo(CONTRACTOR_DECIDED_WINDOW, 2);
    expect(byId.has(OLDEST)).toBe(false);
    // The pending proposal predates all of them and is on the rail, priced
    // on its live pair.
    expect(byId.get(PATIENT)).toMatchObject({ jobs: 1, pendingJobs: 1, pricedJobs: 1 });
    expect(byId.get(PATIENT)!.impact!).toBeGreaterThan(0);
  });

  test('inside the window every decided proposal still counts', async () => {
    await seed(CONTRACTOR_DECIDED_WINDOW - 1);
    const rows = await rail();
    const byId = new Map(rows.map(r => [r.id, r]));
    expect(byId.get(OLDEST)).toMatchObject({ jobs: 1, pricedJobs: 1 });
    expect(byId.get(OLDEST)!.impact).toBeCloseTo(5, 2);
    expect(byId.get(PROLIFIC)).toMatchObject({ jobs: CONTRACTOR_DECIDED_WINDOW - 1 });
  });

  test('no statement binds a list of proposal ids or returns every decided proposal', async () => {
    await seed(CONTRACTOR_DECIDED_WINDOW + 150);
    const log = captureQueries();
    try {
      await rail();
    } finally {
      log.stop();
    }
    const w = widest(log.stats);
    expect(w ? `${w.params} params: ${w.sql.slice(0, 200)}` : 'no queries').toMatch(/^(\d|[1-4]\d) params/);
    const l = largest(log.stats);
    // The window itself is the largest read the rail makes.
    expect(l?.rows ?? 0).toBeLessThanOrEqual(CONTRACTOR_DECIDED_WINDOW + 5);
  });
});
