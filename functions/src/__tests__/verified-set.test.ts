/**
 * Every public "verified" count reads one definition, and it is not a
 * system_config key prefix.
 *
 * What happened (notes/verified-traders-zero-2026-09-02.md): migration
 * 0100 renamed the key that recorded a Manifold link, three counts had
 * the old prefix inlined, and all three silently answered zero for
 * sixteen hours. The Telarchy floor said 0 active traders, two daily
 * markets settled on 0 and the next opened at 1.0. Nothing threw: a
 * `LIKE` against a prefix nothing writes is a valid query returning a
 * valid zero.
 *
 * The badge moved again on 2026-09-02, out of system_config entirely and
 * into `record_links`, and at the same time linking stopped requiring
 * the quality gates. So there are now two different sets and the counts
 * must read the right one: `record_links` is who WEARS a handle, which
 * anybody holding an account can do, and `earn_claims` is whose record
 * was PAID for, which is the farm-resistant set these public numbers
 * have always meant. A market resolves against them, so the meaning is
 * held still on purpose.
 */
process.env.API_KEY = process.env.API_KEY || 'test-master-key-verified-set';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'verified-set-secret-abcdefghijkl';

jest.mock('../db/client', () => require('./harness/test-db'));

import { randomUUID } from 'crypto';
import { agents, earnClaims, recordLinks, trades } from '../db/schema';
import { clearAllTtlCaches } from '../lib/ttl-cache';
import { toUnits } from '../lib/validation';
import { paidManifoldLinkAgents, paidManifoldLinkCount, platformStats } from '../services/platform-stats';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const PAID = 'vs-paid';
const BADGED = 'vs-badged-only';

beforeAll(async () => {
  await ensureMigrations();
});

beforeEach(async () => {
  await truncateAll();
  clearAllTtlCaches();
  await db.insert(agents).values([
    { id: PAID, apiKeyHash: 'h-vs-paid', balance: toUnits(0) },
    { id: BADGED, apiKeyHash: 'h-vs-badged', balance: toUnits(0) },
  ]);
  // One participant was paid for their record; one only wears the badge,
  // which since 2026-09-02 costs nothing but a bio edit.
  await db.insert(earnClaims).values({
    id: randomUUID(),
    agentId: PAID,
    key: 'manifold_link',
    refId: 'mf-paid-1',
    credits: 5000,
  });
  await db.insert(recordLinks).values([
    { agentId: PAID, provider: 'manifold', externalId: 'mf-paid-1', handle: 'realTomBayes' },
    { agentId: BADGED, provider: 'manifold', externalId: 'mf-free-1', handle: 'four_days_old' },
  ]);
});

describe('the verified set', () => {
  test('THE RULE: it is who was PAID for a record, not who wears a badge', async () => {
    expect(await paidManifoldLinkCount()).toBe(1);
    const set = await paidManifoldLinkAgents([PAID, BADGED]);
    expect([...set]).toEqual([PAID]);
  });

  test('a free badge does not enter it, however new the account', async () => {
    const set = await paidManifoldLinkAgents([BADGED]);
    expect(set.size).toBe(0);
  });

  test('an empty ask is an empty answer, not every participant', async () => {
    expect((await paidManifoldLinkAgents([])).size).toBe(0);
  });
});

describe('the public counts', () => {
  test('THE RULE: the count a market resolves on is not zero while links exist', async () => {
    // The failure itself: a count that reads a store nothing writes any
    // more answers zero, and zero is a number a market will settle on.
    const stats = await platformStats();
    expect(stats.manifoldImportCount).toBe(1);
  });

  test('weekly active verified traders counts a paid trader over the 100-credit floor', async () => {
    await db.insert(trades).values([
      {
        id: randomUUID(),
        workspaceId: 'ws-vs',
        marketId: 'm-vs',
        agentId: PAID,
        direction: 'higher',
        shares: toUnits(1),
        cost: toUnits(500),
      },
      {
        id: randomUUID(),
        workspaceId: 'ws-vs',
        marketId: 'm-vs',
        agentId: BADGED,
        direction: 'higher',
        shares: toUnits(1),
        cost: toUnits(500),
      },
    ]);
    clearAllTtlCaches();
    const stats = await platformStats();
    // Both traded enough; only the paid one is verified.
    expect(stats.weeklyActiveVerifiedTraders).toBe(1);
  });
});

describe('the retired stores', () => {
  test('THE RULE: no count reads a system_config key prefix for this', async () => {
    // Written as a source check because the failure mode is silence:
    // the query succeeds, the number is wrong, and no test that only
    // asserts a number can tell one zero from another.
    const { readFileSync } = require('fs');
    const { join } = require('path');
    for (const f of ['../services/platform-stats.ts', '../services/data-room.ts', '../routes/marketplace.ts']) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect(src).not.toMatch(/manifold-claimed:/);
      expect(src).not.toMatch(/record-handle:/);
    }
  });
});
