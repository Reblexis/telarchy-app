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

/**
 * A branch preview revision runs with DB_POOL_MAX=1 (docs/infra/deploy.md,
 * "Branch previews"): one production connection for sessions, one beta
 * connection for data. The default must not move, and a nonsense value must
 * fall back to it rather than to pg's 10.
 */
describe('DB_POOL_MAX', () => {
  const orig = process.env.DB_POOL_MAX;
  afterEach(() => {
    if (orig === undefined) delete process.env.DB_POOL_MAX;
    else process.env.DB_POOL_MAX = orig;
  });

  function poolMaxWith(value: string | undefined): number {
    if (value === undefined) delete process.env.DB_POOL_MAX;
    else process.env.DB_POOL_MAX = value;
    let max = 0;
    jest.isolateModules(() => {
      max = (require('../db/client') as typeof import('../db/client')).POOL_MAX;
    });
    return max;
  }

  it('a preview runs a 1-connection pool', () => {
    expect(poolMaxWith('1')).toBe(1);
  });

  it('unset, nonsense and zero all mean the default 4', () => {
    expect(poolMaxWith(undefined)).toBe(4);
    expect(poolMaxWith('lots')).toBe(4);
    expect(poolMaxWith('0')).toBe(4);
  });
});
