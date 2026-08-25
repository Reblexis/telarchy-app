/**
 * Apply the Drizzle migrations in ../drizzle to DATABASE_URL and exit.
 *
 * Runs inside the container when AUTO_MIGRATE=true (docker-entrypoint.sh), so a
 * self-hosted `docker compose up` on an empty database yields a working
 * instance without drizzle-kit (a dev dependency) in the runtime image. The
 * managed deploy migrates in its workflow instead. Same journal as
 * `npm run db:migrate`; nothing here is specific to either path.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'path';
import { Pool } from 'pg';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[migrate] DATABASE_URL is not set');
    process.exit(2);
  }
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(__dirname, '..', 'drizzle') });
    console.log('[migrate] database is up to date');
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('[migrate] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
