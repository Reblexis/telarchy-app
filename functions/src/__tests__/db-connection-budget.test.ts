/**
 * The pg pool must respect the database's connection budget.
 *
 * Regression (2026-08-20 outage): Cloud SQL telarchy-pg (db-f1-micro,
 * max_connections=25 at the time) was exhausted because every API instance
 * opened pg's default 10-connection pool with no acquire timeout. Prod plus
 * the candidate revision plus probe-failing instances ate every slot; new
 * instances could not start and requests hung 54 seconds before dying as
 * 503s. The budget arithmetic lives in docs/infra/deploy.md ("connection
 * budget"); this test pins the numbers the doc promises.
 */

import { BETA_POOL_MAX, POOL_MAX, pool } from '../db/client';

describe('db pool connection budget', () => {
  it('opens at most 5 connections per instance, across both stores', () => {
    // Since the beta got its own database (2026-08-20) an instance can hold
    // two pools. The per-instance ceiling did not move: 4 for the live store
    // plus 1 for the beta, and the beta pool is only ever created on an
    // instance a beta request actually reaches.
    expect(pool.options.max).toBe(POOL_MAX);
    expect(POOL_MAX + BETA_POOL_MAX).toBe(5);
  });

  it('fails an acquire fast instead of queuing forever', () => {
    expect(pool.options.connectionTimeoutMillis).toBe(5_000);
  });

  it('releases idle connections back to the budget', () => {
    expect(pool.options.idleTimeoutMillis).toBe(30_000);
  });
});
