/**
 * Attribution: the `source` slug and the activated-participants metric
 * (docs/agent-economy.md, "Attribution").
 */
jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, authUser, trades } from '../db/schema';
import { activatedParticipants, creatorSource, isValidSourceSlug, sourceFromCookieHeader } from '../lib/attribution';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

describe('slug and cookie', () => {
  test('slug grammar', () => {
    expect(isValidSourceSlug('github')).toBe(true);
    expect(isValidSourceSlug('hn-2026')).toBe(true);
    expect(isValidSourceSlug('GitHub')).toBe(false);
    expect(isValidSourceSlug('a'.repeat(33))).toBe(false);
    expect(isValidSourceSlug('')).toBe(false);
    expect(isValidSourceSlug(42)).toBe(false);
  });

  test('cookie header parsing', () => {
    expect(sourceFromCookieHeader('a=1; ta_ref=github; b=2')).toBe('github');
    expect(sourceFromCookieHeader('ta_ref=Bad%20Value')).toBeNull();
    expect(sourceFromCookieHeader('other=1')).toBeNull();
    expect(sourceFromCookieHeader(undefined)).toBeNull();
  });
});

const day = (d: string, h = 12) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00Z`);

async function user(id: string, source: string | null) {
  await db.insert(authUser).values({ id, name: id, email: `${id}@example.com`, source });
}
async function agent(id: string, extra: Partial<typeof agents.$inferInsert> = {}) {
  await db.insert(agents).values({ id, apiKeyHash: `h-${id}`, balance: 0, ...extra });
}
async function trade(agentId: string, at: Date, n = 1) {
  for (let i = 0; i < n; i++) {
    await db.insert(trades).values({
      id: `t-${agentId}-${at.toISOString()}-${i}`,
      workspaceId: 'ws',
      agentId,
      marketId: 'm',
      direction: 'higher',
      shares: 1,
      cost: 1,
      createdAt: at,
    });
  }
}

describe('creatorSource', () => {
  test('returns the user source or null', async () => {
    await user('u1', 'github');
    await user('u2', null);
    expect(await creatorSource(db, 'u1')).toBe('github');
    expect(await creatorSource(db, 'u2')).toBeNull();
    expect(await creatorSource(db, 'nobody')).toBeNull();
    expect(await creatorSource(db, undefined)).toBeNull();
  });
});

describe('activatedParticipants', () => {
  const window = { source: 'github', start: day('2026-09-01', 0), end: day('2026-10-01', 0) };

  test('counts an agent with 3 trades on 2 distinct days, by its own source or its user', async () => {
    await agent('bot-a', { source: 'github' });
    await trade('bot-a', day('2026-09-02'), 2);
    await trade('bot-a', day('2026-09-03'), 1);
    await user('u-gh', 'github');
    await agent('human-gh', { authUserId: 'u-gh' });
    await trade('human-gh', day('2026-09-05'), 1);
    await trade('human-gh', day('2026-09-06'), 1);
    await trade('human-gh', day('2026-09-07'), 1);
    const rows = await activatedParticipants(db, window);
    expect(rows).toEqual([
      { agentId: 'bot-a', trades: 3, days: 2 },
      { agentId: 'human-gh', trades: 3, days: 3 },
    ]);
  });

  test('requires 2 distinct days and 3 trades', async () => {
    await agent('one-day', { source: 'github' });
    await trade('one-day', day('2026-09-02'), 5);
    await agent('two-trades', { source: 'github' });
    await trade('two-trades', day('2026-09-02'), 1);
    await trade('two-trades', day('2026-09-03'), 1);
    expect(await activatedParticipants(db, window)).toEqual([]);
  });

  test('ignores trades outside the window and other sources', async () => {
    await agent('late', { source: 'github' });
    await trade('late', day('2026-10-02'), 3);
    await trade('late', day('2026-10-03'), 3);
    await agent('hn', { source: 'hn' });
    await trade('hn', day('2026-09-02'), 3);
    await trade('hn', day('2026-09-03'), 3);
    expect(await activatedParticipants(db, window)).toEqual([]);
  });

  test('excludes platform-operated agents, platform admins, and anything they own', async () => {
    await user('founder', 'github');
    await agent('founder-self', { authUserId: 'founder', platformAdmin: true, source: 'github' });
    await agent('founder-bot', { ownerUserId: 'founder', source: 'github' });
    await agent('founder-sub', { ownerAgentId: 'founder-self', source: 'github' });
    await agent('house-bot', { platformOperated: true, source: 'github' });
    for (const id of ['founder-self', 'founder-bot', 'founder-sub', 'house-bot']) {
      await trade(id, day('2026-09-02'), 2);
      await trade(id, day('2026-09-03'), 2);
    }
    await agent('stranger', { source: 'github' });
    await trade('stranger', day('2026-09-02'), 2);
    await trade('stranger', day('2026-09-03'), 2);
    expect(await activatedParticipants(db, window)).toEqual([{ agentId: 'stranger', trades: 4, days: 2 }]);
  });
});
