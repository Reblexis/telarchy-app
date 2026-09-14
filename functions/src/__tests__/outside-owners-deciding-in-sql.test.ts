/**
 * "Outside owners deciding" counts in SQL (docs/infra/deploy.md, "Platform
 * stats count in SQL").
 *
 * The public stats read computed it by loading every decided proposal of the
 * trailing week, site-wide, into the process and filtering in JS. A floor that
 * decides a proposal a second puts 600k rows in that week, on a 512 MiB
 * instance, every 60 seconds. The definition is pinned in
 * outside-owners-deciding.test.ts; this file pins that the answer never costs a
 * row per decided proposal.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, proposals, workspaces } from '../db/schema';
import { outsideOwnersDeciding7d } from '../services/platform-stats';
import { captureQueries } from './harness/query-log';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const day = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * day);

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

async function floor(id: string, owner: string, house: boolean) {
  await db
    .insert(agents)
    .values({ id: owner, apiKeyHash: `h-${owner}`, balance: 0, platformOperated: house })
    .onConflictDoNothing();
  await db.insert(workspaces).values({ id, name: id, createdBy: owner, visibility: 'public', createdAt: ago(30) });
}

test('the count is one answer from the database, never a row per decided proposal', async () => {
  // A house machine floor that decided 300 proposals this week, and one
  // outside owner who decided three.
  await floor('ws-chess', 'chess-operator', true);
  await floor('ws-patrik', 'patrik', false);
  const rows = [
    ...Array.from({ length: 300 }, (_, i) => ({ ws: 'ws-chess', by: 'chess-operator', i })),
    ...Array.from({ length: 3 }, (_, i) => ({ ws: 'ws-patrik', by: 'patrik', i: 1000 + i })),
  ];
  await db.insert(proposals).values(
    rows.map(r => ({
      id: `p-${r.i}`,
      workspaceId: r.ws,
      title: `P${r.i}`,
      description: '',
      proposedBy: 'someone',
      status: r.i % 2 === 0 ? ('approved' as const) : ('declined' as const),
      resolvedBy: r.by,
      resolvedAt: ago(1),
      conditionalMarketIds: [],
      createdAt: ago(2),
    })),
  );

  const log = captureQueries();
  let n: number;
  try {
    n = await outsideOwnersDeciding7d();
  } finally {
    log.stop();
  }
  expect(n).toBe(1);
  const proposalReads = log.stats.filter(s => /from "proposals"/i.test(s.sql));
  expect(proposalReads.length).toBeGreaterThan(0);
  const most = Math.max(...proposalReads.map(s => s.rows));
  expect(`${most} rows`).toBe('1 rows');
});
