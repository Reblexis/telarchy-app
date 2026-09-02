/**
 * THE RULE (docs/liquidity-purchases.md, invariant 1): the liquidity wallet
 * is pool money and spends FIRST, and a tradeable balance is only ever
 * touched for what the wallet could not cover.
 *
 * A contract's conditional pair is a pool like any other, so staking one has
 * to obey the same order as the Inject button. It matters more since
 * 2026-09-01: every account is granted matched liquidity at signup, so a
 * proposer whose pool money is entirely in the wallet is now the ordinary
 * case rather than an exotic one.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { agents, markets, metrics, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { fromUnits, toUnits } from '../lib/validation';
import { createConditionalMarkets } from '../services/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-stake-wallet';
const OWNER = 'agent-sw-owner';
const WALLET_ONLY = 'agent-sw-wallet';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-sw-owner', balance: toUnits(1000) },
    // What a newcomer looks like the day they arrive: a small tradeable
    // balance and their granted pool money in the wallet.
    { id: WALLET_ONLY, apiKeyHash: 'h-sw-wallet', balance: toUnits(10), liquidityBalance: toUnits(300) },
  ]);
  await db.insert(workspaces).values({ id: WS, name: 'Stake Wallet', createdBy: OWNER, visibility: 'public' });
  await db.insert(metrics).values({
    id: 'metric-sw',
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: 'mkt-base-sw',
    workspaceId: WS,
    metricId: 'metric-sw',
    metricName: 'Revenue',
    targetDate: '2026-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 10,
    pool: initialPool(10),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    branch: null,
  });
});

const purses = async (id: string) => {
  const [a] = await db.select().from(agents).where(eq(agents.id, id));
  return { balance: fromUnits(a.balance as number), wallet: fromUnits(a.liquidityBalance as number) };
};

describe('staking a contract spends the wallet first', () => {
  test('a stake the wallet covers never touches the tradeable balance', async () => {
    // 50 per market across the approved and declined branches: 100 in all,
    // which the 300-credit wallet covers on its own.
    await createConditionalMarkets('prop-sw-1', WS, { contributions: { [WALLET_ONLY]: 50 }, strict: true });

    const after = await purses(WALLET_ONLY);
    expect(after.wallet).toBe(200);
    expect(after.balance).toBe(10);
  });

  test('a stake never drives the tradeable balance below zero', async () => {
    await createConditionalMarkets('prop-sw-2', WS, { contributions: { [WALLET_ONLY]: 50 }, strict: true });

    const after = await purses(WALLET_ONLY);
    expect(after.balance).toBeGreaterThanOrEqual(0);
  });

  test('what the wallet cannot cover comes off the balance, and no further', async () => {
    // 155 per market is 310 in all: 300 from the wallet, 10 from the balance.
    await createConditionalMarkets('prop-sw-3', WS, { contributions: { [WALLET_ONLY]: 155 }, strict: true });

    const after = await purses(WALLET_ONLY);
    expect(after.wallet).toBe(0);
    expect(after.balance).toBe(0);
  });

  test('a stake beyond both purses is refused rather than paid on credit', async () => {
    await expect(
      createConditionalMarkets('prop-sw-4', WS, { contributions: { [WALLET_ONLY]: 400 }, strict: true }),
    ).rejects.toThrow(/[Ii]nsufficient/);
    const after = await purses(WALLET_ONLY);
    expect(after.wallet).toBe(300);
    expect(after.balance).toBe(10);
  });
});
