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

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as schema from '../../db/schema';
import { clearAllTtlCaches } from '../../lib/ttl-cache';

// Jest gives every test file a fresh module registry, so this module (and its
// PGlite) is rebuilt per file. Replaying the whole journal per file cost more
// wall clock than the tests themselves, so the first file in each worker
// replays it and stashes a dump of the migrated data dir on globalThis (which
// does survive across files); later files boot from the dump. The journal
// property above is intact: every dump is produced by a journal replay in
// this same worker. The afterAll below closes each file's instance - before
// it, every file leaked a ~1GB WASM instance and workers grew past 3GB.
type HarnessGlobal = typeof globalThis & { __testDbDump?: Blob | File };
const dumped = (globalThis as HarnessGlobal).__testDbDump;
const client = dumped ? new PGlite({ loadDataDir: dumped }) : new PGlite();
export const db = drizzle(client, { schema });

if (typeof afterAll === 'function') {
  afterAll(async () => {
    await client.close();
  });
}

let migrationsApplied: Promise<void> | null = null;

export function ensureMigrations(): Promise<void> {
  if (!migrationsApplied) {
    migrationsApplied = dumped
      ? client.waitReady
      : applyMigrations().then(async () => {
          (globalThis as HarnessGlobal).__testDbDump = await client.dumpDataDir('none');
        });
  }
  return migrationsApplied;
}

async function applyMigrations(): Promise<void> {
  const dir = join(__dirname, '..', '..', '..', 'drizzle');
  const journal = JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const files = [...journal.entries].sort((a, b) => a.idx - b.idx).map(e => `${e.tag}.sql`);
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8');
    const statements = sql.split('--> statement-breakpoint');
    for (const raw of statements) {
      const stmt = raw.trim();
      if (!stmt) continue;
      try {
        await client.exec(stmt);
      } catch (e) {
        throw new Error(`Migration ${f} failed on statement:\n${stmt}\n\n${(e as Error).message}`);
      }
    }
  }
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
