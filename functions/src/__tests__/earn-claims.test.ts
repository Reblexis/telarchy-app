/**
 * Claiming an earn. The rules that carry the anti-farming weight, and so
 * the ones worth pinning: an earn pays once per participant, an external
 * account pays once ACROSS the platform (one Google account cannot fund
 * two Telarchy accounts), and a price change does not retroactively
 * change what somebody was paid.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { agents, earnClaims, earnRules } from '../db/schema';
import { fromUnits, toUnits } from '../lib/validation';
import { claimEarn, claimedKeys, clearEarnRuleCache, refAlreadyClaimed, setEarnRule } from '../services/earnRules';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  clearEarnRuleCache();
  await db.insert(agents).values([
    { id: 'ann', apiKeyHash: 'h-ann', balance: toUnits(0) },
    { id: 'bob', apiKeyHash: 'h-bob', balance: toUnits(0) },
  ]);
  await db.insert(earnRules).values([
    {
      key: 'link_oauth',
      label: 'Connect a Google or GitHub account',
      credits: 200,
      liquidityCredits: 200,
      kind: 'flat',
      note: '',
    },
    { key: 'signup_user', label: 'Create an account', credits: 100, liquidityCredits: 100, kind: 'flat', note: '' },
    { key: 'daily_trade', label: 'Trade today', credits: 25, liquidityCredits: 0, kind: 'daily', note: '' },
  ]);
  clearEarnRuleCache();
});

const balanceOf = async (id: string) => {
  const [a] = await db.select({ balance: agents.balance }).from(agents).where(eq(agents.id, id));
  return fromUnits(a.balance as number);
};

const walletOf = async (id: string) => {
  const [a] = await db.select({ w: agents.liquidityBalance }).from(agents).where(eq(agents.id, id));
  return fromUnits(a.w as number);
};

describe('claiming', () => {
  test('pays the price and records the claim', async () => {
    const r = await claimEarn({ agentId: 'ann', key: 'link_oauth', refId: 'google-1' });
    expect(r).toEqual({ granted: 200 });
    expect(await balanceOf('ann')).toBe(200);
    expect([...(await claimedKeys('ann'))]).toEqual(['link_oauth']);
  });

  test('the same participant cannot claim one earn twice', async () => {
    await claimEarn({ agentId: 'ann', key: 'link_oauth', refId: 'google-1' });
    const again = await claimEarn({ agentId: 'ann', key: 'link_oauth', refId: 'google-1' });
    expect(again).toBeNull();
    expect(await balanceOf('ann')).toBe(200);
  });

  test('ONE PROVIDER ACCOUNT CANNOT FUND TWO TELARCHY ACCOUNTS', async () => {
    // The rule the whole design leans on: without it, one aged Google
    // account is an unlimited credit printer across fresh accounts.
    await claimEarn({ agentId: 'ann', key: 'link_oauth', refId: 'google-1' });
    const second = await claimEarn({ agentId: 'bob', key: 'link_oauth', refId: 'google-1' });
    expect(second).toBeNull();
    expect(await balanceOf('bob')).toBe(0);
    expect(await refAlreadyClaimed('link_oauth', 'google-1')).toBe(true);
  });

  test('a different provider account still pays a different participant', async () => {
    await claimEarn({ agentId: 'ann', key: 'link_oauth', refId: 'google-1' });
    const other = await claimEarn({ agentId: 'bob', key: 'link_oauth', refId: 'google-2' });
    expect(other).toEqual({ granted: 200 });
  });

  test('two claims racing each other pay exactly once', async () => {
    // The reason the uniqueness lives in the database rather than in a
    // check-then-write: two link callbacks arriving together.
    const [a, b] = await Promise.all([
      claimEarn({ agentId: 'ann', key: 'link_oauth', refId: 'google-1' }),
      claimEarn({ agentId: 'ann', key: 'link_oauth', refId: 'google-1' }),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await balanceOf('ann')).toBe(200);
  });

  test('a claim records what it paid, not what the price later becomes', async () => {
    await claimEarn({ agentId: 'ann', key: 'link_oauth', refId: 'google-1' });
    await setEarnRule('link_oauth', { credits: 25 }, 'viktor');
    const [row] = await db.select().from(earnClaims).where(eq(earnClaims.agentId, 'ann'));
    expect(row.credits).toBe(200);
    expect(await balanceOf('ann')).toBe(200);
  });

  test('a disabled earn claims nothing and pays nothing', async () => {
    await setEarnRule('link_oauth', { enabled: false }, 'viktor');
    const r = await claimEarn({ agentId: 'ann', key: 'link_oauth', refId: 'google-9' });
    expect(r).toEqual({ granted: 0 });
    expect(await balanceOf('ann')).toBe(0);
  });
});

/**
 * Matched liquidity (owner decision 2026-09-01, design record
 * notes/matched-liquidity-grants-2026-09-01.md).
 *
 * A grant pays two purses: trading credits, and the walled liquidity a floor
 * of one's own needs for depth. The rules that carry the weight are the ones
 * about which rules match and how often, because the matched amount is what
 * one identity can extract through its own market, once.
 */
describe('matched liquidity', () => {
  test('an earn pays the wallet beside the balance, in one act', async () => {
    const r = await claimEarn({ agentId: 'ann', key: 'signup_user' });
    expect(r).toEqual({ granted: 100 });
    expect(await balanceOf('ann')).toBe(100);
    expect(await walletOf('ann')).toBe(100);
  });

  test('the wallet is paid once, however often the claim is retried', async () => {
    await claimEarn({ agentId: 'ann', key: 'signup_user' });
    expect(await claimEarn({ agentId: 'ann', key: 'signup_user' })).toBeNull();
    expect(await walletOf('ann')).toBe(100);
    expect(await balanceOf('ann')).toBe(100);
  });

  test('a recurring rule matches nothing: a daily pool grant is a faucet that refills', async () => {
    await claimEarn({ agentId: 'ann', key: 'daily_trade', period: '2026-09-01' });
    await claimEarn({ agentId: 'ann', key: 'daily_trade', period: '2026-09-02' });
    expect(await balanceOf('ann')).toBe(50);
    expect(await walletOf('ann')).toBe(0);
  });

  test('an unmatched rule pays trading credits and no pool money', async () => {
    await db.insert(earnRules).values({
      key: 'manifold_link',
      label: 'Link Manifold',
      credits: 5000,
      liquidityCredits: 0,
      kind: 'flat',
      note: '',
    });
    clearEarnRuleCache();
    await claimEarn({ agentId: 'bob', key: 'manifold_link', refId: 'mf-1' });
    expect(await balanceOf('bob')).toBe(5000);
    expect(await walletOf('bob')).toBe(0);
  });

  test('the operator can reprice the matched amount, and the price is what the table said at the time', async () => {
    await setEarnRule('signup_user', { liquidityCredits: 500 }, 'admin');
    clearEarnRuleCache();
    await claimEarn({ agentId: 'ann', key: 'signup_user' });
    expect(await walletOf('ann')).toBe(500);
    await setEarnRule('signup_user', { liquidityCredits: 0 }, 'admin');
    clearEarnRuleCache();
    await claimEarn({ agentId: 'bob', key: 'signup_user' });
    expect(await walletOf('bob')).toBe(0);
    expect(await walletOf('ann')).toBe(500);
  });

  test('a negative matched amount is refused, the same as a negative price', async () => {
    await expect(setEarnRule('signup_user', { liquidityCredits: -1 }, 'admin')).rejects.toThrow();
  });
});
