/**
 * The invariant behind the 2026-08-20 outage, pinned:
 *
 *   (prod instances + candidate instances) x pool max  <=  max_connections - headroom
 *
 * Cloud SQL telarchy-pg runs max_connections=50; cloud-sql-proxy sessions,
 * migrations and cron need headroom, so the app's budget is 40. Instances
 * come from --max-instances in the CI deploy (both the prod revision and the
 * no-traffic candidate can run at that scale); connections per instance from
 * the pool in db/client.ts. Nothing in the repo stated this arithmetic before
 * tonight, and it was only violated at scale-out, which is exactly when
 * nobody is watching. If this test fails, re-do the arithmetic in
 * docs/infra/deploy.md ("connection budget") before touching the numbers.
 * (Suggested by the telarchy-0a session during the outage review.)
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { BETA_POOL_MAX, POOL_MAX, pool } from '../db/client';

const CONNECTION_BUDGET = 40; // max_connections=50 minus operational headroom

function deployedMaxInstances(): number {
  const workflow = readFileSync(join(__dirname, '../../../.github/workflows/deploy-cloudrun.yml'), 'utf8');
  const m = workflow.match(/--max-instances\s+(\d+)/);
  if (!m) throw new Error('deploy-cloudrun.yml no longer sets --max-instances');
  return Number(m[1]);
}

describe('connection budget invariant', () => {
  it('prod + candidate at full scale stay inside the database budget', () => {
    const maxInstances = deployedMaxInstances();
    const poolMax = pool.options.max ?? 10;
    expect(poolMax).toBe(POOL_MAX);
    // Since 2026-08-20 an instance can hold TWO pools: the live store, and the
    // beta store if a beta request ever reaches it (db/client.ts). The worst
    // case has to count both, or the budget silently doubles the first time
    // somebody opens the beta.
    const perInstance = POOL_MAX + BETA_POOL_MAX;
    const worstCase = 2 * maxInstances * perInstance; // prod revision + candidate revision
    expect(worstCase).toBeLessThanOrEqual(CONNECTION_BUDGET);
  });
});
