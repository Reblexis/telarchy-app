/**
 * The daily streak (owner ask 2026-08-30). What is worth pinning is not
 * the arithmetic but the two rules that make it an earn rather than a
 * giveaway: it is paid for TRADING on a new day, never for arriving, and
 * a missed day resets the run. The third is that it pays once a day
 * however many times it is called, which is a database constraint and so
 * is tested by calling it twice.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { agents, earnClaims, earnRules, trades } from '../db/schema';
import { fromUnits, toUnits } from '../lib/validation';
import { clearEarnRuleCache, settleDailyStreak } from '../services/earnRules';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const DAY_BASE = 25;

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  clearEarnRuleCache();
  await db.insert(agents).values([{ id: 'ann', apiKeyHash: 'h-ann', balance: toUnits(0) }]);
  await db
    .insert(earnRules)
    .values([{ key: 'daily_trade', label: 'Trade on a new day', credits: DAY_BASE, kind: 'daily', note: '' }]);
  clearEarnRuleCache();
});

const balanceOf = async (id: string) => {
  const [a] = await db.select({ balance: agents.balance }).from(agents).where(eq(agents.id, id));
  return fromUnits(a.balance as number);
};

/** A trade on the given UTC day, at noon so no timezone can move it. */
let seq = 0;
const tradedOn = (day: string) =>
  db.insert(trades).values({
    id: `t-${++seq}`,
    workspaceId: 'ws',
    agentId: 'ann',
    marketId: 'm1',
    direction: 'higher',
    shares: 1,
    cost: 1,
    createdAt: new Date(`${day}T12:00:00.000Z`),
  });

/** Days counting back from the reference instant, most recent first. */
const daysBack = (n: number, from = '2026-08-30') => {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00.000Z`);
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
};

const NOW = new Date('2026-08-30T18:00:00.000Z');

describe('the daily streak', () => {
  test('PAYS NOTHING FOR SHOWING UP WITHOUT TRADING', async () => {
    // The rule the whole design rests on: an earn that pays for a page
    // load is a farm, because a page load brings nothing to price.
    const s = await settleDailyStreak('ann', NOW);
    expect(s).toEqual({ days: 0, earnedToday: false, todayCredits: 0, nextCredits: DAY_BASE });
    expect(await balanceOf('ann')).toBe(0);
  });

  test("today's first trade pays day one", async () => {
    await tradedOn('2026-08-30');
    const s = await settleDailyStreak('ann', NOW);
    expect(s).toMatchObject({ days: 1, earnedToday: true, todayCredits: DAY_BASE });
    expect(await balanceOf('ann')).toBe(DAY_BASE);
  });

  test('the run grows with consecutive days and stops at the cap', async () => {
    for (const d of daysBack(6)) await tradedOn(d);
    const s = await settleDailyStreak('ann', NOW);
    // Six consecutive days, so the multiplier is at its 4x ceiling.
    expect(s).toMatchObject({ days: 6, todayCredits: DAY_BASE * 4, nextCredits: DAY_BASE * 4 });
  });

  test('the third consecutive day pays three times day one', async () => {
    for (const d of daysBack(3)) await tradedOn(d);
    const s = await settleDailyStreak('ann', NOW);
    expect(s).toMatchObject({ days: 3, todayCredits: DAY_BASE * 3 });
  });

  test('A MISSED DAY RESETS THE RUN', async () => {
    // Traded four days ago, three days ago, then today: the gap means
    // today is day one again, not day four.
    await tradedOn('2026-08-26');
    await tradedOn('2026-08-27');
    await tradedOn('2026-08-30');
    const s = await settleDailyStreak('ann', NOW);
    expect(s).toMatchObject({ days: 1, todayCredits: DAY_BASE });
  });

  test('PAYS ONCE A DAY HOWEVER MANY TIMES IT IS CALLED', async () => {
    // Every trade calls this, and so does every load of /earn. Only the
    // unique index stops the second call paying again.
    await tradedOn('2026-08-30');
    await settleDailyStreak('ann', NOW);
    await settleDailyStreak('ann', NOW);
    await settleDailyStreak('ann', new Date('2026-08-30T23:59:00.000Z'));
    expect(await balanceOf('ann')).toBe(DAY_BASE);
    const claims = await db.select().from(earnClaims).where(eq(earnClaims.key, 'daily_trade'));
    expect(claims).toHaveLength(1);
    expect(claims[0].period).toBe('2026-08-30');
  });

  test('a run that ended yesterday still reads as a run, and today is the next step', async () => {
    for (const d of daysBack(2, '2026-08-29')) await tradedOn(d);
    const s = await settleDailyStreak('ann', NOW);
    expect(s).toEqual({ days: 2, earnedToday: false, todayCredits: 0, nextCredits: DAY_BASE * 3 });
    expect(await balanceOf('ann')).toBe(0);
  });

  test('a new day pays again, on top of yesterday', async () => {
    await tradedOn('2026-08-29');
    await settleDailyStreak('ann', new Date('2026-08-29T18:00:00.000Z'));
    await tradedOn('2026-08-30');
    await settleDailyStreak('ann', NOW);
    expect(await balanceOf('ann')).toBe(DAY_BASE + DAY_BASE * 2);
  });

  test('renders nothing at all when the operator disables the row', async () => {
    await db.update(earnRules).set({ enabled: false }).where(eq(earnRules.key, 'daily_trade'));
    clearEarnRuleCache();
    await tradedOn('2026-08-30');
    expect(await settleDailyStreak('ann', NOW)).toBeNull();
    expect(await balanceOf('ann')).toBe(0);
  });

  test("the operator's price is day one's price", async () => {
    await db.update(earnRules).set({ credits: 60 }).where(eq(earnRules.key, 'daily_trade'));
    clearEarnRuleCache();
    for (const d of daysBack(2)) await tradedOn(d);
    const s = await settleDailyStreak('ann', NOW);
    expect(s).toMatchObject({ days: 2, todayCredits: 120 });
  });
});
