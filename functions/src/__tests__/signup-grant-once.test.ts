/**
 * THE RULE (market-integrity I5): a route that creates credits from nothing
 * pays a person, ONCE.
 *
 * `ensureParticipant` auto-provisions the participant row behind the first
 * authenticated browser call, and it pays the signup grant. It then calls
 * `claimEarn('signup_user')` to record the earn so the /earn page can show
 * what is left. `claimEarn` does not only record: it credits too
 * (services/earnRules.ts). So every browser account was landing at exactly
 * twice the published price, and the /earn page reported the single figure
 * against the doubled balance.
 *
 * Invisible to credit-ledger-reconciliation.test.ts, because both grants
 * write honest ledger rows and the balance still equals the ledger sum. The
 * assertion that catches it is against the PUBLISHED PRICE, which is what
 * this test makes.
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

import { eq } from 'drizzle-orm';
import { agents, authUser, creditLedger, earnRules } from '../db/schema';
import { fromUnits } from '../lib/validation';
import { clearEarnRuleCache, earnCredits, earnLiquidityCredits } from '../services/earnRules';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const UID = 'user-newcomer';

/** The private auto-provisioner, reached the way every browser call reaches
 *  it: through the module, with a uid and nothing else. */
async function provisionBrowserParticipant(uid: string): Promise<string> {
  const mod = await import('../routes/userauth');
  // resolveCallerParticipantId is the only exported door onto
  // ensureParticipant; the router closes over it.
  const { userauthRouter } = mod;
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

describe('the signup grant is paid once', () => {
  test('a new browser account lands at the published signup price, not twice it', async () => {
    await db.insert(authUser).values({ id: UID, name: 'Newcomer', email: 'newcomer@example.com' });

    const price = await earnCredits('signup_user');
    expect(price).toBeGreaterThan(0);

    const participantId = await provisionBrowserParticipant(UID);
    const [row] = await db.select().from(agents).where(eq(agents.id, participantId));

    expect(fromUnits(row.balance as number)).toBe(price);
  });

  test('exactly one signup_grant ledger row is written for the signup itself', async () => {
    await db.insert(authUser).values({ id: UID, name: 'Newcomer', email: 'newcomer@example.com' });

    const participantId = await provisionBrowserParticipant(UID);
    const rows = await db.select().from(creditLedger).where(eq(creditLedger.agentId, participantId));
    const signup = rows.filter(r => r.reason === 'signup_grant');

    expect(signup).toHaveLength(1);
  });
});

/**
 * The wallet half of the same grant (owner decision 2026-09-01,
 * notes/matched-liquidity-grants-2026-09-01.md). It is paid where the
 * credits are paid, so the same rule that stops a double payment stops a
 * double wallet grant: a signup that landed at twice the price would
 * otherwise land at twice the depth too.
 */
describe('the matched liquidity is paid once, beside it', () => {
  test('a new browser account holds the published depth, in the walled purse', async () => {
    await db.insert(authUser).values({ id: UID, name: 'Newcomer', email: 'newcomer@example.com' });
    await db.insert(earnRules).values({
      key: 'signup_user',
      label: 'Create an account',
      credits: 100,
      liquidityCredits: 300,
      kind: 'flat',
      note: '',
    });
    clearEarnRuleCache();

    const participantId = await provisionBrowserParticipant(UID);
    const [row] = await db.select().from(agents).where(eq(agents.id, participantId));

    expect(fromUnits(row.liquidityBalance as number)).toBe(await earnLiquidityCredits('signup_user'));
    expect(fromUnits(row.liquidityBalance as number)).toBe(300);
    // Two purses, never one sum: the depth is not spendable as a trade.
    expect(fromUnits(row.balance as number)).toBe(await earnCredits('signup_user'));
  });

  test('a rule that matches nothing leaves the wallet empty', async () => {
    await db.insert(authUser).values({ id: UID, name: 'Newcomer', email: 'newcomer@example.com' });
    await db.insert(earnRules).values({
      key: 'signup_user',
      label: 'Create an account',
      credits: 100,
      liquidityCredits: 0,
      kind: 'flat',
      note: '',
    });
    clearEarnRuleCache();

    const participantId = await provisionBrowserParticipant(UID);
    const [row] = await db.select().from(agents).where(eq(agents.id, participantId));

    expect(fromUnits(row.liquidityBalance as number)).toBe(0);
  });
});
