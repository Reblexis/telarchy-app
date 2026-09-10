/**
 * Every hot predicate has an index (docs/infra/deploy.md, "Reads are bounded
 * in the size of a workspace"). Migration 0117 adds them; drizzle-kit keeps
 * only what schema.ts declares, so this pins the migration and the schema
 * agreeing, against the database the journal builds.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { sql } from 'drizzle-orm';
import { db, ensureMigrations } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});

const EXPECTED: Array<{ table: string; name: string; partial?: RegExp }> = [
  { table: 'markets', name: 'markets_ws_proposal_idx' },
  { table: 'markets', name: 'markets_ws_open_idx', partial: /WHERE \(resolved = false\)/ },
  {
    table: 'markets',
    name: 'markets_ws_open_baseline_idx',
    partial: /WHERE \(\(resolved = false\) AND \(proposal_id IS NULL\)\)/,
  },
  { table: 'markets', name: 'markets_resolved_at_idx', partial: /WHERE \(resolved = true\)/ },
  { table: 'proposals', name: 'proposals_ws_status_created_idx' },
  { table: 'proposals', name: 'proposals_ws_created_idx' },
  { table: 'proposals', name: 'proposals_ws_pending_decide_idx', partial: /WHERE \(status = 'pending'::text\)/ },
  { table: 'proposals', name: 'proposals_status_resolved_idx' },
  { table: 'proposals', name: 'proposals_proposed_by_created_idx' },
  { table: 'liquidity_events', name: 'liquidity_events_market_idx' },
  { table: 'trades', name: 'trades_market_idx' },
];

test.each(EXPECTED)('$table has $name', async ({ table, name, partial }) => {
  const res = (await db.execute(
    sql`select indexdef from pg_indexes where schemaname = 'public' and tablename = ${table} and indexname = ${name}`,
  )) as unknown as { rows: Array<{ indexdef: string }> };
  expect(res.rows).toHaveLength(1);
  if (partial) expect(res.rows[0].indexdef).toMatch(partial);
});
