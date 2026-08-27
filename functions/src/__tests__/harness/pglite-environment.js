/**
 * Node test environment that owns one PGlite per jest worker.
 *
 * Jest rebuilds the sandbox global AND its `process` wrapper for every test
 * file, so nothing a test module stashes on either survives to the next
 * file. This module, however, is loaded by the worker itself (real require,
 * real context), so its module state lives exactly once per worker process.
 * The environment hands each sandbox a getter for the shared instance;
 * test-db.ts builds its per-file drizzle wrapper around it.
 *
 * The instance is created lazily on first use, so suites that never touch
 * the database (pure unit tests) pay nothing.
 *
 * Migrations replay the JOURNAL (drizzle/meta/_journal.json), in journal
 * order, once per worker - the same set production applies. See test-db.ts
 * for why the journal and not a directory listing.
 */
const { TestEnvironment } = require('jest-environment-node');
const { readFileSync } = require('fs');
const { join } = require('path');

let shared = null;

function getShared() {
  if (!shared) {
    const { PGlite } = require('@electric-sql/pglite');
    const client = new PGlite();
    shared = { client, migrated: applyMigrations(client) };
  }
  return shared;
}

async function applyMigrations(client) {
  const dir = join(__dirname, '..', '..', '..', 'drizzle');
  const journal = JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8'));
  const files = [...journal.entries].sort((a, b) => a.idx - b.idx).map(e => `${e.tag}.sql`);
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8');
    for (const raw of sql.split('--> statement-breakpoint')) {
      const stmt = raw.trim();
      if (!stmt) continue;
      try {
        await client.exec(stmt);
      } catch (e) {
        throw new Error(`Migration ${f} failed on statement:\n${stmt}\n\n${e.message}`);
      }
    }
  }
}

class PgliteTestEnvironment extends TestEnvironment {
  async setup() {
    await super.setup();
    this.global.__getTestDbShared = getShared;
    // The shared PGlite lives in this worker's realm; tests run in a vm
    // sandbox with its own intrinsics. Dates and errors cross that boundary
    // in both directions (query params in, driver errors out) and both
    // sides check them with `instanceof`, so the sandbox gets this realm's
    // constructors. Fake timers still work: they subclass whatever Date
    // they find here.
    this.global.Date = Date;
    this.global.Error = Error;
  }
}

module.exports = PgliteTestEnvironment;
