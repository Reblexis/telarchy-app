/**
 * The earn table decides how many free credits an account receives, and
 * free credits are what a sybil farm runs on, so the rules that matter
 * are: the operator's price is what gets granted, a disabled rule grants
 * nothing, an unseeded table still grants what the constants always
 * granted, and every edit leaves a reconstructable trail (the table is
 * editable mid-season, so "what did it say when this account was funded?"
 * has to have an answer).
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { earnRules } from '../db/schema';
import { AppError } from '../lib/errors';
import { clearEarnRuleCache, earnCredits, earnRuleHistoryFor, listEarnRules, setEarnRule } from '../services/earnRules';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  clearEarnRuleCache();
});

/** truncateAll empties the seeded rows, so each test states its own table. */
async function seed(rows: Array<{ key: string; credits: number; kind?: string; enabled?: boolean }>) {
  for (const r of rows) {
    await db.insert(earnRules).values({
      key: r.key,
      label: r.key,
      credits: r.credits,
      kind: r.kind ?? 'flat',
      enabled: r.enabled ?? true,
      note: '',
    });
  }
  clearEarnRuleCache();
}

describe('what a task grants', () => {
  test("the operator's price is what is granted", async () => {
    await seed([{ key: 'signup_user', credits: 1234 }]);
    expect(await earnCredits('signup_user')).toBe(1234);
  });

  test('a disabled rule grants nothing, without deleting its price', async () => {
    await seed([{ key: 'signup_user', credits: 10000, enabled: false }]);
    expect(await earnCredits('signup_user')).toBe(0);
    const [row] = await db.select().from(earnRules).where(eq(earnRules.key, 'signup_user'));
    expect(row.credits).toBe(10000);
  });

  test('an unseeded table falls back to the constants, so signup never breaks', async () => {
    // Nothing seeded: an instance that never ran the seed, or a
    // self-hosted one, must grant exactly what it granted before.
    expect(await earnCredits('signup_user')).toBe(10000);
    expect(await earnCredits('signup_agent')).toBe(0);
    expect(await earnCredits('manifold_link')).toBe(10000);
  });

  test('a negative price cannot be stored', async () => {
    await seed([{ key: 'signup_user', credits: 100 }]);
    await expect(setEarnRule('signup_user', { credits: -5 }, 'admin')).rejects.toBeInstanceOf(AppError);
  });

  test('editing an unknown rule is refused rather than creating one', async () => {
    await expect(setEarnRule('not_a_rule', { credits: 10 }, 'admin')).rejects.toBeInstanceOf(AppError);
  });
});

describe('editing mid-season', () => {
  test('a new price takes effect immediately for the next grant', async () => {
    await seed([{ key: 'signup_user', credits: 10000 }]);
    expect(await earnCredits('signup_user')).toBe(10000);
    await setEarnRule('signup_user', { credits: 1000 }, 'viktor');
    // No cache wait: setEarnRule clears it, because a price the operator
    // just announced has to be true when they check it.
    expect(await earnCredits('signup_user')).toBe(1000);
  });

  test('every edit is appended to the history, with who and when', async () => {
    await seed([{ key: 'signup_user', credits: 10000 }]);
    await setEarnRule('signup_user', { credits: 5000 }, 'viktor');
    await setEarnRule('signup_user', { credits: 250, note: 'farmed accounts showed up' }, 'viktor');
    const hist = await earnRuleHistoryFor('signup_user');
    expect(hist.map(h => h.credits)).toEqual([5000, 250]);
    expect(hist[1].note).toBe('farmed accounts showed up');
    expect(hist[1].changedBy).toBe('viktor');
  });

  test('the table lists every rule, disabled ones included, for the editor', async () => {
    await seed([
      { key: 'signup_user', credits: 10000 },
      { key: 'signup_agent', credits: 0, enabled: false },
    ]);
    const rules = await listEarnRules();
    expect(rules.map(r => r.key)).toEqual(['signup_agent', 'signup_user']);
  });
});
