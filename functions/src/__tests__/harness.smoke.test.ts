/**
 * Smoke test for the pglite + drizzle harness.
 *
 * Confirms that all production migrations apply against pglite and that
 * truncateAll clears state between tests. If this test ever breaks, every
 * other integration test will too — fix it first.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { sql } from 'drizzle-orm';
import { workspaces } from '../db/schema';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

test('migrations apply and core tables are reachable', async () => {
  const result = await db.execute(
    sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  const rows = result.rows as Array<{ n: number }>;
  expect(rows[0].n).toBeGreaterThan(10);
});

test('truncate clears workspace inserts between tests (round 1)', async () => {
  await db.insert(workspaces).values({
    id: 'ws-smoke-1',
    name: 'Smoke',
    createdBy: 'tester',
    visibility: 'private',
  });
  const found = await db.select().from(workspaces);
  expect(found).toHaveLength(1);
});

test('truncate clears workspace inserts between tests (round 2)', async () => {
  const found = await db.select().from(workspaces);
  expect(found).toHaveLength(0);
});
