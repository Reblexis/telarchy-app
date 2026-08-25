/**
 * Exactly-one-instance execution for the in-process scheduled jobs.
 *
 * Cloud Run runs up to 4 instances of the published revision plus 4 of the
 * candidate, and every instance arms every timer in server.ts. Before this
 * existed the limit sweep ran up to 8x every 12 seconds, all doing identical
 * work against the same database. A Postgres advisory lock elects a winner
 * per tick; the losers skip silently.
 *
 *   tick ─▶ checkout dedicated client ─▶ pg_try_advisory_lock(KEY)
 *              │                              │ got it        │ someone else has it
 *              │                              ▼               ▼
 *              │                          run job          skip tick
 *              │                              │
 *              └── finally: unlock + release client back to the pool
 *
 * Why a DEDICATED client: an advisory lock belongs to the session (the
 * connection), not the transaction. Taken through pool.query() the lock
 * would ride whichever pooled connection served it and leak back into the
 * pool still held. Checking out one client for the duration pins lock and
 * connection together; if the instance dies mid-job the connection drops and
 * Postgres releases the lock, so failover is the next tick on a surviving
 * instance.
 *
 * Lock keys are centralized here so two jobs can never collide on a number.
 */

import { pool } from '../db/client';

/** One namespace int for the app, one per job. Never reuse a value. */
export const LOCK_KEYS = {
  resolve: 71001,
  limitSweep: 71002,
  dailyMarketRefresh: 71003,
  dailyMaintenance: 71004,
  startupCatchUp: 71005,
} as const;

export type LockName = keyof typeof LOCK_KEYS;

/**
 * Run `fn` only if this instance wins the advisory lock; otherwise resolve
 * to 'skipped'. The lock is held for the duration of `fn` and always
 * released, so a slow job on one instance means others skip, never queue.
 */
export async function withSingletonLock(name: LockName, fn: () => Promise<void>): Promise<'ran' | 'skipped'> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [
      LOCK_KEYS[name],
    ]);
    if (!rows[0]?.locked) return 'skipped';
    try {
      const started = Date.now();
      await fn();
      const ms = Date.now() - started;
      // A job outliving its own interval is starvation-in-progress; say so.
      if (ms > 60_000) console.warn(`Singleton job "${name}" took ${Math.round(ms / 1000)}s`);
    } finally {
      await client.query('select pg_advisory_unlock($1)', [LOCK_KEYS[name]]);
    }
    return 'ran';
  } finally {
    client.release();
  }
}
