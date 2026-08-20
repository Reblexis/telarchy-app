import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Connection budget: Cloud SQL telarchy-pg has max_connections=50 and Cloud
// Run may run prod + candidate revisions at up to 4 instances each, so each
// instance gets at most 5 connections (2 x 4 x 5 = 40 < 50). The acquire
// timeout makes a starved request fail as a 500 in seconds rather than hang.
// The arithmetic lives in docs/infra/deploy.md ("connection budget"); change
// it there first.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});
export const db = drizzle(pool, { schema });

export type Db = typeof db;
