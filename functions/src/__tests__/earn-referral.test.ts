/**
 * THE RULE (docs/guides/credits.md, "Bringing a friend"): a referrer earns a
 * SHARE of what their referee takes from the earn table in the referee's
 * first week, never a bounty for a signup, and at most ten referees pay one
 * referrer.
 *
 * Proposal 31 on the Telarchy floor, priced as a share by the owner
 * (telarchy umbrella, notes/referral-earn-2026-09-07.md). What is worth
 * pinning: attribution is decided once at signup from the stored slug and
 * only a browser account can be a referrer; the share follows every grant
 * the table pays, at the row's percentage on that day; each grant pays the
 * share once however often anything retries; nothing is paid after day
 * seven, from a disabled row, or by the eleventh referee.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => {
  const { createHash } = require('crypto');
  return {
    hashKey: (raw: string) => createHash('sha256').update(raw).digest('hex'),
    getAuthWorkspaceMemberships: async () => [],
    getUserWorkspaceMemberships: async () => [],
  };
});

import { and, eq } from 'drizzle-orm';
import { agents, authUser, creditLedger, earnClaims, earnRules, trades } from '../db/schema';
import { fromUnits } from '../lib/validation';
import {
  claimEarn,
  clearEarnRuleCache,
  REFERRAL_MAX_REFEREES,
  REFERRAL_WINDOW_DAYS,
  referralLinkFor,
  referralSummary,
  setEarnRule,
  settleDailyStreak,
} from '../services/earnRules';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});

const SIGNUP = 100;
const LINK = 200;
const PERCENT = 10;

beforeEach(async () => {
  await truncateAll();
  await db.insert(earnRules).values([
    { key: 'signup_user', label: 'Create an account', credits: SIGNUP, liquidityCredits: 100, kind: 'flat', note: '' },
    { key: 'link_oauth', label: 'Connect', credits: LINK, kind: 'flat', note: '' },
    { key: 'daily_trade', label: 'Trade on a new day', credits: 25, kind: 'daily', note: '' },
    { key: 'referral', label: 'Bring a friend', credits: PERCENT, kind: 'share', note: '' },
  ]);
  clearEarnRuleCache();
  // The referrer: a person with a nickname, which is what the link carries.
  await db.insert(authUser).values({ id: 'u-ann', name: 'Ann', email: 'ann@example.com' });
  await db.insert(agents).values({ id: 'ann', apiKeyHash: 'h-ann', balance: 0, authUserId: 'u-ann', nickname: 'Ann' });
});

/** The private auto-provisioner, reached the way every browser call
 *  reaches it (see signup-grant-once.test.ts). `source` is what the auth
 *  layer stored from the landing's `?ref=` cookie. */
async function signUp(uid: string, source: string | null): Promise<string> {
  await db.insert(authUser).values({ id: uid, name: uid, email: `${uid}@example.com`, source });
  const { userauthRouter } = await import('../routes/userauth');
  const express = (await import('express')).default;
  const request = (await import('supertest')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/auth', (req: any, _res: any, next: any) => {
    req.auth = { uid, capabilities: new Set(['read']) };
    next();
  });
  app.use('/api/auth', userauthRouter);
  await request(app).get('/api/auth/me');
  const [row] = await db.select().from(agents).where(eq(agents.authUserId, uid));
  return row.id;
}

const agentRow = async (id: string) => (await db.select().from(agents).where(eq(agents.id, id)))[0];
const balanceOf = async (id: string) => fromUnits((await agentRow(id)).balance as number);
const shareRows = (referrer: string) =>
  db
    .select()
    .from(earnClaims)
    .where(and(eq(earnClaims.agentId, referrer), eq(earnClaims.key, 'referral')));

describe('attribution is decided once, at signup, from the stored slug', () => {
  test("a slug that is a person's nickname makes the newcomer their referee, case-insensitively", async () => {
    const bob = await signUp('u-bob', 'ann');
    const row = await agentRow(bob);
    expect(row.referredBy).toBe('ann');
    expect(row.referredAt).toBeTruthy();
  });

  test("a slug that is nobody's nickname attributes nothing", async () => {
    const bob = await signUp('u-bob', 'github');
    expect((await agentRow(bob)).referredBy).toBeNull();
  });

  test('no slug attributes nothing', async () => {
    const bob = await signUp('u-bob', null);
    expect((await agentRow(bob)).referredBy).toBeNull();
  });

  test("a bot's nickname cannot refer: only a browser account is a referrer", async () => {
    await db.insert(agents).values({ id: 'bot', apiKeyHash: 'h-bot', balance: 0, nickname: 'botty' });
    const bob = await signUp('u-bob', 'botty');
    expect((await agentRow(bob)).referredBy).toBeNull();
    expect(await balanceOf('bot')).toBe(0);
  });

  test('attribution is recorded even while the referral row is disabled', async () => {
    await setEarnRule('referral', { enabled: false }, null);
    const bob = await signUp('u-bob', 'ann');
    expect((await agentRow(bob)).referredBy).toBe('ann');
    expect(await balanceOf('ann')).toBe(0);
  });
});

describe('the referrer earns a share of every grant the referee takes in their first week', () => {
  test("the signup grant pays the row's percentage on top, as its own ledger row", async () => {
    const bob = await signUp('u-bob', 'ann');
    expect(await balanceOf('ann')).toBe((SIGNUP * PERCENT) / 100);
    const rows = await db.select().from(creditLedger).where(eq(creditLedger.agentId, 'ann'));
    expect(rows).toHaveLength(1);
    expect(rows[0].refId).toBe('earn:referral');
    const [claim] = await shareRows('ann');
    expect(claim.period.startsWith(`${bob}|`)).toBe(true);
    expect(claim.credits).toBe((SIGNUP * PERCENT) / 100);
  });

  test("the referee's own grant is unchanged: the share is paid on top, never taken", async () => {
    const bob = await signUp('u-bob', 'ann');
    expect(await balanceOf(bob)).toBe(SIGNUP);
  });

  test('liquidity credits are not shared', async () => {
    await signUp('u-bob', 'ann');
    expect((await agentRow('ann')).liquidityBalance).toBe(0);
  });

  test('a later grant in the week pays its share too', async () => {
    const bob = await signUp('u-bob', 'ann');
    await claimEarn({ agentId: bob, key: 'link_oauth', refId: 'google-1' });
    expect(await balanceOf('ann')).toBe(((SIGNUP + LINK) * PERCENT) / 100);
  });

  test('the daily streak pays its share', async () => {
    const bob = await signUp('u-bob', 'ann');
    await db.insert(trades).values({
      id: 't-1',
      workspaceId: 'ws',
      agentId: bob,
      marketId: 'm1',
      direction: 'higher',
      shares: 1,
      cost: 1,
      createdAt: new Date(),
    });
    await settleDailyStreak(bob);
    expect(await balanceOf('ann')).toBe(((SIGNUP + 25) * PERCENT) / 100);
  });

  test('each grant pays the share once, however often anything retries', async () => {
    const bob = await signUp('u-bob', 'ann');
    await claimEarn({ agentId: bob, key: 'link_oauth', refId: 'google-1' });
    await claimEarn({ agentId: bob, key: 'link_oauth', refId: 'google-1' });
    expect(await balanceOf('ann')).toBe(((SIGNUP + LINK) * PERCENT) / 100);
    expect(await shareRows('ann')).toHaveLength(2);
  });

  test("a grant after the referee's seventh day pays nothing", async () => {
    const bob = await signUp('u-bob', 'ann');
    const old = new Date(Date.now() - (REFERRAL_WINDOW_DAYS + 1) * 24 * 3600 * 1000);
    await db.update(agents).set({ createdAt: old, referredAt: old }).where(eq(agents.id, bob));
    await claimEarn({ agentId: bob, key: 'link_oauth', refId: 'google-1' });
    expect(await balanceOf('ann')).toBe((SIGNUP * PERCENT) / 100);
  });

  test('a disabled row pays nothing', async () => {
    const bob = await signUp('u-bob', 'ann');
    await setEarnRule('referral', { enabled: false }, null);
    await claimEarn({ agentId: bob, key: 'link_oauth', refId: 'google-1' });
    expect(await balanceOf('ann')).toBe((SIGNUP * PERCENT) / 100);
  });

  test("an unreferred participant's grant pays nobody", async () => {
    const bob = await signUp('u-bob', null);
    await claimEarn({ agentId: bob, key: 'link_oauth', refId: 'google-1' });
    expect(await balanceOf('ann')).toBe(0);
    expect(await db.select().from(earnClaims).where(eq(earnClaims.key, 'referral'))).toHaveLength(0);
  });

  test('a share is paid at the percentage on that day: a re-priced row changes the next share only', async () => {
    const bob = await signUp('u-bob', 'ann');
    await setEarnRule('referral', { credits: 20 }, null);
    await claimEarn({ agentId: bob, key: 'link_oauth', refId: 'google-1' });
    expect(await balanceOf('ann')).toBe((SIGNUP * PERCENT) / 100 + (LINK * 20) / 100);
    const first = (await shareRows('ann')).find(r => r.period.endsWith('|signup_user|'));
    expect(first?.credits).toBe((SIGNUP * PERCENT) / 100);
  });
});

describe('at most ten referees pay one referrer', () => {
  test('the eleventh referee is attributed but pays nothing; the first ten keep paying', async () => {
    expect(REFERRAL_MAX_REFEREES).toBe(10);
    const referees: string[] = [];
    for (let i = 0; i < REFERRAL_MAX_REFEREES; i++) referees.push(await signUp(`u-r${i}`, 'ann'));
    const paidTen = (SIGNUP * PERCENT * REFERRAL_MAX_REFEREES) / 100;
    expect(await balanceOf('ann')).toBe(paidTen);

    const eleventh = await signUp('u-r-eleven', 'ann');
    expect((await agentRow(eleventh)).referredBy).toBe('ann');
    expect(await balanceOf('ann')).toBe(paidTen);
    await claimEarn({ agentId: eleventh, key: 'link_oauth', refId: 'google-11' });
    expect(await balanceOf('ann')).toBe(paidTen);

    await claimEarn({ agentId: referees[0], key: 'link_oauth', refId: 'google-0' });
    expect(await balanceOf('ann')).toBe(paidTen + (LINK * PERCENT) / 100);
  });
});

describe('the link and the summary', () => {
  test('the link is the lowercased nickname', () => {
    expect(referralLinkFor('Ann')).toBe('https://telarchy.com/?ref=ann');
  });

  test('a nickname outside the slug grammar has no link', () => {
    expect(referralLinkFor('ann_x')).toBeNull();
    expect(referralLinkFor('a'.repeat(33))).toBeNull();
    expect(referralLinkFor(null)).toBeNull();
  });

  test('the summary counts every referee and sums what they paid', async () => {
    await signUp('u-bob', 'ann');
    await signUp('u-cat', 'ann');
    const s = await referralSummary('ann');
    expect(s).toEqual({ link: 'https://telarchy.com/?ref=ann', referees: 2, credits: (2 * SIGNUP * PERCENT) / 100 });
  });
});
