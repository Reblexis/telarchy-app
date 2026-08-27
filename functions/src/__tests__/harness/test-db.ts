/**
 * In-process Postgres for backend integration tests.
 *
 * Use by adding this near the top of a test file (jest.mock is hoisted, so the
 * call must be a literal `jest.mock(...)`):
 *
 *   jest.mock('../db/client', () => require('./harness/test-db'));
 *
 *   import { ensureMigrations, truncateAll, db } from './harness/test-db';
 *
 *   beforeAll(async () => { await ensureMigrations(); });
 *   beforeEach(async () => { await truncateAll(); });
 *
 * `db` re-exports a drizzle instance pointed at a pglite database, using the
 * same schema as production. `ensureMigrations` replays the migrations named by
 * `drizzle/meta/_journal.json`, in journal order, once per process (each split
 * on `--> statement-breakpoint`). `truncateAll` wipes every public table
 * between tests.
 *
 * The JOURNAL, not a directory listing. drizzle-kit applies exactly what the
 * journal names, so a migration file nobody journalled does not exist in
 * production - while a directory glob applied it here and made the whole suite
 * green. That is not hypothetical: on 2026-08-17 an unjournalled
 * `ADD COLUMN resets_every` passed 820 tests and 500'd every public floor the
 * moment the code that reads the column deployed. Tests now run the same set of
 * migrations production will, so the omission fails here first.
 */

import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../../db/schema';
import { clearAllTtlCaches } from '../../lib/ttl-cache';

// Jest rebuilds the sandbox global AND its `process` wrapper for every test
// file, so nothing stashed on either survives to the next file (an earlier
// version cached a data-dir dump on globalThis; every file silently rebuilt
// it). The worker's single PGlite therefore lives in the test environment
// (harness/pglite-environment.js, wired up by jest.config.js), whose module
// state is per worker process, and reaches each file through the
// __getTestDbShared getter the environment injects. One WASM instance per
// worker instead of one per file - the per-file instances were retained
// even after close() (~350MB each, in WASM memory that jest's heap-based
// workerIdleMemoryLimit cannot see) and workers grew past 5GB, which
// starved the whole machine whenever suites ran.
//
// Files still start from an empty database: ensureMigrations truncates on
// its first call in each file (this module is rebuilt per file, so the
// flag resets with the file). Tests must not run DDL - a schema change
// would outlive the file. None do today.
declare global {
  // eslint-disable-next-line no-var
  var __getTestDbShared: () => { client: PGlite; migrated: Promise<void> };
}
const shared = globalThis.__getTestDbShared();
const client = shared.client;
export const db = drizzle(client, { schema });

let fileReady: Promise<void> | null = null;

export function ensureMigrations(): Promise<void> {
  if (!fileReady) {
    fileReady = shared.migrated.then(() => truncateAll());
  }
  return fileReady;
}

export async function truncateAll(): Promise<void> {
  const result = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const names = result.rows
    .map(r => r.tablename)
    .filter(n => n !== '__drizzle_migrations')
    .map(n => `"${n}"`)
    .join(', ');
  if (names) {
    await client.exec(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
  }
  // The in-process TTL caches (lib/ttl-cache.ts) hold answers computed from
  // the rows just truncated; a cache that outlives its data serves ghosts.
  clearAllTtlCaches();
}

/**
 * The harness stands in for `db/client`, so it has to answer for everything
 * that module exports which a route may call.
 *
 * One store here, which is also production's shape: there is nothing to
 * mirror an account INTO, so this is the same no-op the real one performs
 * off the beta (see db/client.ts, mirrorAccountIntoStore).
 */
export async function mirrorAccountIntoStore(_userId: string): Promise<void> {
  return;
}

/** Same reason: the beta swap does not exist here. */
export function currentStoreName(): 'beta' | 'production' {
  return 'production';
}
