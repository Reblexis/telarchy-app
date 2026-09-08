/**
 * The one-off trim of legacy balances to what the earn table pays today
 * (services/legacy-balance-cap.ts; docs/guides/credits.md, "A price cut
 * applies to what was already granted"; owner ask 2026-09-08 "can you cap
 * it at 10k credits for all of them").
 *
 * THE RULE THIS EXISTS TO ENFORCE: two people who did the same thing hold
 * the same credits whichever week they did it. A grant paid under an older,
 * higher price is trimmed to the current one; nothing else is touched, and
 * a trim can only ever take credits away.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { agents, creditLedger } from '../db/schema';
import { toUnits } from '../lib/validation';
import { capLegacyBalances } from '../services/legacy-balance-cap';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const REF = 'legacy-balance-cap-test';
const CAP = 10_000;

type Seed = {
  id: string;
  credits: number;
  liquidityCredits?: number;
  platformOperated?: boolean;
  platformAdmin?: boolean;
};

async function seed(rows: Seed[]) {
  await db.insert(agents).values(
    rows.map(r => ({
      id: r.id,
      apiKeyHash: `hash-${r.id}`,
      balance: toUnits(r.credits),
      liquidityBalance: toUnits(r.liquidityCredits ?? 0),
      platformOperated: r.platformOperated ?? false,
      platformAdmin: r.platformAdmin ?? false,
    })),
  );
}

const balanceOf = async (id: string) => {
  const [row] = await db.select().from(agents).where(eq(agents.id, id));
  return { balance: Number(row.balance), liquidity: Number(row.liquidityBalance) };
};

const ledgerOf = async (id: string) =>
  db.select().from(creditLedger).where(eq(creditLedger.agentId, id));

const run = (over: Partial<Parameters<typeof capLegacyBalances>[0]> = {}) =>
  capLegacyBalances({ capCredits: CAP, refId: REF, apply: true, ...over });

describe('the rule: nobody keeps more granted credits than the table pays today', () => {
  it('trims a participant above the cap to exactly the cap', async () => {
    await seed([{ id: 'rich', credits: 110_500 }]);

    const result = await run();

    expect(await balanceOf('rich')).toMatchObject({ balance: toUnits(CAP) });
    expect(result).toEqual([
      { agentId: 'rich', beforeUnits: toUnits(110_500), afterUnits: toUnits(CAP), deltaUnits: toUnits(CAP - 110_500) },
    ]);
  });

  it('leaves a participant at or below the cap alone, and never tops one up', async () => {
    await seed([
      { id: 'at-cap', credits: CAP },
      { id: 'newcomer', credits: 5_300 },
      { id: 'broke', credits: 0 },
    ]);

    const result = await run();

    expect(result).toEqual([]);
    expect((await balanceOf('at-cap')).balance).toBe(toUnits(CAP));
    expect((await balanceOf('newcomer')).balance).toBe(toUnits(5_300));
    expect((await balanceOf('broke')).balance).toBe(0);
    expect(await ledgerOf('newcomer')).toHaveLength(0);
  });

  it('only ever debits: every recorded delta is negative', async () => {
    await seed([
      { id: 'a', credits: 110_500 },
      { id: 'b', credits: 11_000 },
      { id: 'c', credits: 9_999 },
    ]);

    const result = await run();

    expect(result).toHaveLength(2);
    for (const r of result) expect(r.deltaUnits).toBeLessThan(0);
  });
});

describe('who is out of scope', () => {
  it('never touches a house account, however large its balance', async () => {
    await seed([
      { id: 'adminbot', credits: 35_870, platformOperated: true },
      { id: 'owner', credits: 958_419, platformAdmin: true },
    ]);

    const result = await run();

    expect(result).toEqual([]);
    expect((await balanceOf('adminbot')).balance).toBe(toUnits(35_870));
    expect((await balanceOf('owner')).balance).toBe(toUnits(958_419));
  });

  it('never touches an exempt participant', async () => {
    await seed([
      { id: 'vm-agent', credits: 11_000 },
      { id: 'person', credits: 11_000 },
    ]);

    const result = await run({ exemptIds: ['vm-agent'] });

    expect(result.map(r => r.agentId)).toEqual(['person']);
    expect((await balanceOf('vm-agent')).balance).toBe(toUnits(11_000));
  });

  it('never touches the liquidity wallet', async () => {
    await seed([{ id: 'rich', credits: 110_500, liquidityCredits: 300 }]);

    await run();

    expect(await balanceOf('rich')).toEqual({ balance: toUnits(CAP), liquidity: toUnits(300) });
  });
});

describe('the record it leaves', () => {
  it('writes one admin_adjustment row per trim, whose balance_after matches the new balance', async () => {
    await seed([{ id: 'rich', credits: 110_500 }]);

    await run();

    const rows = await ledgerOf('rich');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reason: 'admin_adjustment',
      refType: null,
      refId: REF,
      deltaUnits: toUnits(CAP - 110_500),
      balanceAfterUnits: toUnits(CAP),
    });
  });

  it('is idempotent: a second run trims nothing and writes nothing', async () => {
    await seed([{ id: 'rich', credits: 110_500 }]);

    await run();
    const second = await run();

    expect(second).toEqual([]);
    expect(await ledgerOf('rich')).toHaveLength(1);
    expect((await balanceOf('rich')).balance).toBe(toUnits(CAP));
  });
});

describe('the broken rows', () => {
  it('takes a zeroed id to zero rather than to the cap', async () => {
    await seed([{ id: 'backfill-artifact', credits: 7_000_000_000 }]);

    const result = await run({ zeroIds: ['backfill-artifact'] });

    expect((await balanceOf('backfill-artifact')).balance).toBe(0);
    expect(result).toEqual([
      {
        agentId: 'backfill-artifact',
        beforeUnits: toUnits(7_000_000_000),
        afterUnits: 0,
        deltaUnits: -toUnits(7_000_000_000),
      },
    ]);
  });

  it('leaves an already-zero id alone on a second run', async () => {
    await seed([{ id: 'backfill-artifact', credits: 7_000_000_000 }]);

    await run({ zeroIds: ['backfill-artifact'] });
    const second = await run({ zeroIds: ['backfill-artifact'] });

    expect(second).toEqual([]);
    expect(await ledgerOf('backfill-artifact')).toHaveLength(1);
  });

  it('zeroes a house account only when its id is named, never by the cap', async () => {
    await seed([{ id: 'house-artifact', credits: 500_000, platformOperated: true }]);

    const result = await run({ zeroIds: ['house-artifact'] });

    expect(result.map(r => r.agentId)).toEqual(['house-artifact']);
    expect((await balanceOf('house-artifact')).balance).toBe(0);
  });
});

describe('the dry run', () => {
  it('reports exactly what apply would do and changes nothing', async () => {
    await seed([
      { id: 'rich', credits: 110_500 },
      { id: 'artifact', credits: 7_000_000_000 },
      { id: 'newcomer', credits: 5_300 },
    ]);

    const planned = await capLegacyBalances({
      capCredits: CAP,
      refId: REF,
      zeroIds: ['artifact'],
      apply: false,
    });

    expect(planned.map(r => r.agentId).sort()).toEqual(['artifact', 'rich']);
    expect((await balanceOf('rich')).balance).toBe(toUnits(110_500));
    expect((await balanceOf('artifact')).balance).toBe(toUnits(7_000_000_000));
    expect(await ledgerOf('rich')).toHaveLength(0);

    const applied = await capLegacyBalances({
      capCredits: CAP,
      refId: REF,
      zeroIds: ['artifact'],
      apply: true,
    });
    expect(applied).toEqual(planned);
  });
});

describe('bad input', () => {
  it('refuses a cap that is not a positive number, rather than zeroing everyone', async () => {
    await seed([{ id: 'rich', credits: 110_500 }]);

    await expect(capLegacyBalances({ capCredits: 0, refId: REF, apply: true })).rejects.toThrow();
    await expect(capLegacyBalances({ capCredits: -5, refId: REF, apply: true })).rejects.toThrow();
    await expect(capLegacyBalances({ capCredits: NaN, refId: REF, apply: true })).rejects.toThrow();

    expect((await balanceOf('rich')).balance).toBe(toUnits(110_500));
  });

  it('refuses an empty refId, so no trim lands without a reason in the ledger', async () => {
    await seed([{ id: 'rich', credits: 110_500 }]);

    await expect(capLegacyBalances({ capCredits: CAP, refId: '', apply: true })).rejects.toThrow();
    expect((await balanceOf('rich')).balance).toBe(toUnits(110_500));
  });
});
