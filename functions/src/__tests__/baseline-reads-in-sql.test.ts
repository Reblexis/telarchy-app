/**
 * A read that wants baselines says so in SQL (docs/infra/deploy.md, "Reads
 * are bounded in the size of a workspace"). Every open-market read that only
 * wants the natural-trajectory books used to fetch every open market of the
 * workspace, proposal branches included, and drop the branches in JS; on a
 * floor with thousands of open branches per day that is the whole open set
 * read eight times a minute (notes/snake-load-audit-2026-09-10.md, item 5).
 *
 * Two things are pinned per read: the SQL names `proposal_id` (null for a
 * baseline read, a bound value for a proposal's own read), and a proposal
 * pair never reaches a consensus map.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = {
      agentId: 'agent-bl-owner',
      workspaceId: req.headers['x-workspace-id'],
      capabilities: new Set(['read', 'trade', 'manage']),
    };
    next();
  },
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, permissionGroups, proposals, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { authMiddleware } from '../middleware/auth';
import { marketplaceRouter, resolveProposalShare } from '../routes/marketplace';
import { systemRouter } from '../routes/system';
import { buildConsensusMap } from '../services/metrics';
import { createConditionalMarkets, getProposalMarketSummariesForProposal } from '../services/proposals';
import { buildWorkspaceContext } from '../services/workspace-context';
import { captureQueries, db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
app.use('/api', authMiddleware, systemRouter);
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
  await seed();
});

const WS = 'ws-baseline';
const METRIC = 'metric-bl';
const PROP = 'prop-bl';
const DATE = '2030-12';

async function seed() {
  await db.insert(agents).values({ id: 'agent-bl-owner', apiKeyHash: 'h-bl', balance: 10_000_000 });
  await db.insert(workspaces).values({
    id: WS,
    name: 'Baseline',
    slug: 'baseline',
    createdBy: 'agent-bl-owner',
    visibility: 'public',
  });
  await db.insert(permissionGroups).values({
    id: 'grp-bl',
    workspaceId: WS,
    name: 'Public',
    type: 'public',
    capabilities: ['read', 'trade'],
    memberIds: [],
    sourcePermissions: {},
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(proposals).values({
    id: PROP,
    workspaceId: WS,
    number: 1,
    proposedBy: 'agent-bl-owner',
    title: 'A proposal',
    description: '',
    status: 'pending',
    decideBy: new Date('2030-06-01T00:00:00.000Z'),
  });
  const base = {
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Revenue',
    targetDate: DATE,
    rangeMin: 0,
    rangeMax: 100,
    liquidity: 100,
    pool: initialPool(100),
    active: true,
    resolved: false,
    voided: false,
  };
  await db.insert(markets).values([
    // An untraded baseline, priced at the midpoint.
    { ...base, id: 'mkt-baseline', shares: [0, 0], proposalId: null, branch: null },
    // A traded pair: both branches carry a price.
    { ...base, id: 'mkt-approved', shares: [0, 80], proposalId: PROP, branch: 'approved' },
    { ...base, id: 'mkt-declined', shares: [80, 0], proposalId: PROP, branch: 'declined' },
  ]);
}

/** Every open-market read of `markets` names proposal_id: null or a bound value. */
function openMarketReads(queries: string[]): string[] {
  return queries.filter(q => q.includes('from "markets"') && /"resolved" = /.test(q));
}
function expectEveryOpenReadNamesProposal(queries: string[]) {
  const reads = openMarketReads(queries);
  expect(reads.length).toBeGreaterThan(0);
  for (const q of reads) {
    expect(q).toMatch(/"proposal_id" (is null|= \$\d+)/);
  }
}

async function captured<T>(fn: () => Promise<T>): Promise<{ result: T; queries: string[] }> {
  const cap = captureQueries();
  try {
    const result = await fn();
    return { result, queries: cap.queries };
  } finally {
    cap.stop();
  }
}

describe('a proposal pair never reaches a consensus map', () => {
  // Without the baseline, the only open books on this (metric, date) are
  // the two traded branches: any number in a consensus map came from them.
  beforeEach(async () => {
    await db.delete(markets).where(eq(markets.id, 'mkt-baseline'));
  });

  test('buildConsensusMap: the traded branches price nothing', async () => {
    const { result, queries } = await captured(() => buildConsensusMap(WS));
    expect(result.map).toEqual({});
    expectEveryOpenReadNamesProposal(queries);
  });

  test('getBaselineConsensusMap (through the proposal summary): baselineConsensus is null', async () => {
    const { result, queries } = await captured(() => getProposalMarketSummariesForProposal(PROP, WS));
    expect(result).toHaveLength(1);
    expect(result[0].baselineConsensus).toBeNull();
    expect(result[0].approved?.consensus).not.toBeNull();
    expectEveryOpenReadNamesProposal(queries);
  });
});

describe('every baseline read says proposal_id is null in SQL', () => {
  test('the market spawn reads its source books as baselines', async () => {
    await db.insert(proposals).values({
      id: 'prop-bl-2',
      workspaceId: WS,
      number: 2,
      proposedBy: 'agent-bl-owner',
      title: 'Another',
      description: '',
      status: 'pending',
    });
    const { result, queries } = await captured(() => createConditionalMarkets('prop-bl-2', WS));
    expect(result).toHaveLength(2);
    expectEveryOpenReadNamesProposal(queries);
  });

  test('the marketplace listing', async () => {
    const { result, queries } = await captured(() => request(app).get('/api/marketplace'));
    expect(result.status).toBe(200);
    expect(result.body.map((m: { marketId?: string; id?: string }) => m.marketId ?? m.id)).not.toContain(
      'mkt-approved',
    );
    expectEveryOpenReadNamesProposal(queries);
  });

  test('the floor payload', async () => {
    const { result, queries } = await captured(() => request(app).get('/api/marketplace/baseline'));
    expect(result.status).toBe(200);
    expectEveryOpenReadNamesProposal(queries);
  });

  test('/status?markets=1', async () => {
    const { result, queries } = await captured(() =>
      request(app).get('/api/status?markets=1').set('X-Workspace-Id', WS),
    );
    expect(result.status).toBe(200);
    expectEveryOpenReadNamesProposal(queries);
  });

  test('the share card reads the baselines and the one proposal separately', async () => {
    const { result, queries } = await captured(() => resolveProposalShare('baseline', 1));
    expect(result?.number).toBe(1);
    // The pair is still found: impact is the branch difference.
    expect(result?.impact).not.toBeNull();
    const reads = queries.filter(q => q.includes('from "markets"'));
    expect(reads.length).toBeGreaterThan(0);
    for (const q of reads) expect(q).toMatch(/"proposal_id" (is null|= \$\d+)/);
  });

  test('the workspace brief', async () => {
    const { result, queries } = await captured(() => buildWorkspaceContext(WS));
    expect(result?.markets.map(m => m.marketId)).toEqual(['mkt-baseline']);
    const reads = queries.filter(q => q.includes('from "markets"'));
    expect(reads.length).toBeGreaterThan(0);
    for (const q of reads) expect(q).toMatch(/"proposal_id" (is null|= \$\d+|in \()/);
  });
});
