/**
 * The step where participants are actually lost: they register and never trade.
 *
 * 225 participants have registered and four traded in the last week, and until
 * now nothing counted the gap between those two numbers. This is the measure
 * the 2026-09-01 DX review is judged against, so the rules it encodes matter
 * more than the number it prints:
 *
 *  - A cohort is only the participants who have HAD the whole window. Someone
 *    who registered an hour ago has not failed to trade, they have not had the
 *    chance, and counting them as a failure makes the rate drift with signup
 *    volume rather than with the experience. They are censored.
 *  - A redemption is not a trade. `trades.kind` says so at its definition site
 *    and every list a person reads keys off it; a funnel that forgets would
 *    report bookkeeping as a first trade.
 *  - The credential path is the whole point of the segmentation. A key minted
 *    on a person's own account starts funded; a standalone registration starts
 *    at zero and needs somebody to pay it. Averaging them hides the wall.
 *  - The house's own participants are not customers.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, authUser, markets, metrics, trades } from '../db/schema';
import { toUnits } from '../lib/validation';
import { participantFunnel } from '../services/participant-funnel';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const NOW = new Date('2026-09-01T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400_000);
const minutesAfter = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

const WS = 'ws-funnel';
const METRIC = 'metric-funnel';
const MARKET = 'market-funnel';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Activation',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Activation',
    targetDate: '2099-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 100,
    pool: 100,
    active: true,
    resolved: false,
    voided: false,
  });
});

type Extra = Partial<typeof agents.$inferInsert>;
async function participant(id: string, registeredAt: Date, extra: Extra = {}): Promise<void> {
  await db.insert(agents).values({
    id,
    apiKeyHash: `h-${id}`,
    balance: toUnits(0),
    createdAt: registeredAt,
    ...extra,
  });
}
let seq = 0;
async function tradeAt(agentId: string, at: Date, kind: 'trade' | 'redeem' = 'trade'): Promise<void> {
  seq += 1;
  await db.insert(trades).values({
    id: `t-${seq}`,
    workspaceId: WS,
    agentId,
    marketId: MARKET,
    direction: 'higher',
    shares: 1,
    cost: 1,
    kind,
    createdAt: at,
  });
}

const run = () => participantFunnel({ windowDays: 7, now: NOW });

describe('register-to-first-trade funnel', () => {
  test('a participant who never traded is counted and not converted', async () => {
    await participant('never-traded', daysAgo(30));
    const f = await run();
    expect(f.overall.registered).toBe(1);
    expect(f.overall.converted).toBe(0);
    expect(f.overall.conversionRate).toBe(0);
    expect(f.overall.medianMinutesToFirstTrade).toBeNull();
  });

  test('a participant who traded inside the window converts, with the time recorded', async () => {
    const at = daysAgo(30);
    await participant('traded-fast', at);
    await tradeAt('traded-fast', minutesAfter(at, 20));
    const f = await run();
    expect(f.overall.converted).toBe(1);
    expect(f.overall.conversionRate).toBe(1);
    expect(f.overall.medianMinutesToFirstTrade).toBe(20);
  });

  test('a trade after the window does not convert the cohort it belongs to', async () => {
    const at = daysAgo(30);
    await participant('traded-late', at);
    await tradeAt('traded-late', minutesAfter(at, 8 * 24 * 60)); // day eight, window is seven
    const f = await run();
    expect({ registered: f.overall.registered, converted: f.overall.converted }).toEqual({
      registered: 1,
      converted: 0,
    });
  });

  test('CENSORING: someone who has not had the full window is excluded, not failed', async () => {
    // The rule this protects: a rate that counts yesterday's signups as
    // failures moves with signup volume instead of with the experience.
    await participant('too-recent', daysAgo(2));
    await participant('had-the-window', daysAgo(30));
    const f = await run();
    expect({ registered: f.overall.registered, censored: f.overall.censored }).toEqual({
      registered: 1,
      censored: 1,
    });
  });

  test('a redemption is not a first trade', async () => {
    const at = daysAgo(30);
    await participant('only-redeemed', at);
    await tradeAt('only-redeemed', minutesAfter(at, 10), 'redeem');
    const f = await run();
    expect(f.overall.converted).toBe(0);
  });

  test('the three credential paths are reported separately', async () => {
    await db.insert(authUser).values([{ id: 'u-1', name: 'u', email: 'u@example.com' }]);
    const at = daysAgo(30);
    await participant('is-a-person', at, { authUserId: 'u-1' });
    await participant('owned-by-person', at, { ownerUserId: 'u-1' });
    await participant('stands-alone', at);
    await tradeAt('is-a-person', minutesAfter(at, 5));

    const f = await run();
    const by = Object.fromEntries(f.byCredentialPath.map(r => [r.segment, r]));
    expect(Object.keys(by).sort()).toEqual(['browser_account', 'owned_bot', 'standalone_registration']);
    expect(by.browser_account.converted).toBe(1);
    expect(by.owned_bot.converted).toBe(0);
    expect(by.standalone_registration.converted).toBe(0);
    expect(by.standalone_registration.registered).toBe(1);
  });

  test('the source tag segments the cohort too', async () => {
    const at = daysAgo(30);
    await participant('from-github', at, { source: 'github' });
    await participant('from-nowhere', at);
    await tradeAt('from-github', minutesAfter(at, 3));
    const f = await run();
    const by = Object.fromEntries(f.bySource.map(r => [r.segment, r]));
    expect(by.github.converted).toBe(1);
    expect(by.unattributed.converted).toBe(0);
  });

  test("the house's own participants are not customers", async () => {
    await db.insert(authUser).values([{ id: 'u-admin', name: 'a', email: 'a@example.com' }]);
    const at = daysAgo(30);
    await participant('the-house', at, { platformAdmin: true });
    await participant('house-bot', at, { ownerUserId: 'u-admin' });
    await db
      .update(agents)
      .set({ authUserId: 'u-admin', platformAdmin: true })
      .where(
        // the admin's own participant, so house-bot is owned by a platform admin
        (await import('drizzle-orm')).eq(agents.id, 'the-house'),
      );
    await participant('a-real-one', at);
    const f = await run();
    expect(f.overall.registered).toBe(1);
    expect(f.excludedInternal).toBe(2);
  });

  test('the median is over those who converted, and the rate says how many did not', async () => {
    const at = daysAgo(30);
    for (const [id, mins] of [
      ['a', 10],
      ['b', 30],
      ['c', 50],
    ] as Array<[string, number]>) {
      await participant(id, at);
      await tradeAt(id, minutesAfter(at, mins));
    }
    await participant('d', at); // never traded
    const f = await run();
    expect(f.overall.medianMinutesToFirstTrade).toBe(30);
    expect(f.overall.registered).toBe(4);
    expect(f.overall.converted).toBe(3);
    expect(f.overall.conversionRate).toBeCloseTo(0.75, 6);
  });

  test('an empty platform reports null, never a misleading zero', async () => {
    const f = await run();
    expect(f.overall.registered).toBe(0);
    expect(f.overall.conversionRate).toBeNull();
    expect(f.overall.medianMinutesToFirstTrade).toBeNull();
  });
});
