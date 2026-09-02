/**
 * The two ledgers a market settles on are append-only.
 *
 * `trades` and `liquidity_events` are the record of who put what into which
 * market and when. Every price, payout and refund is derived from them, so an
 * edit rewrites what a market settled on and nothing in the app would notice.
 * They were ordinary tables until 2026-08-16: the day before, a stray
 * smoke-test trade was removed from production with a hand-written DELETE,
 * which is exactly the operation these tests now require to fail.
 *
 * A few operations legitimately remove that history (deleting a workspace or
 * a participant, resetting a workspace, re-attributing an LP row). They opt in
 * per transaction via allowLedgerAdmin, so the intent is at the call site.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq, sql } from 'drizzle-orm';
import {
  agents,
  creditLedger,
  liquidityEvents,
  markets,
  metricDefinitionRevisions,
  metrics,
  proposalRevisions,
  trades,
  workspaces,
} from '../db/schema';
import { initialPool } from '../lib/amm';
import { allowLedgerAdmin } from '../lib/ledger-admin';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

/**
 * Drizzle wraps a driver error in "Failed query: ...", so the trigger's own
 * message lives on the cause chain. Reach for it, or a test asserting the
 * refusal would be asserting Drizzle's phrasing instead.
 */
async function refusal(op: Promise<unknown>): Promise<string> {
  try {
    await op;
  } catch (e) {
    let err: unknown = e,
      seen = '';
    while (err instanceof Error) {
      seen += ` ${err.message}`;
      err = (err as Error & { cause?: unknown }).cause;
    }
    return seen;
  }
  throw new Error('expected the ledger to refuse this, but it succeeded');
}

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-ledger';
const AGENT = 'agent-ledger';
const MARKET = 'market-ledger';

async function seed() {
  await db.insert(agents).values({ id: AGENT, apiKeyHash: 'h-ledger', balance: 0 });
  await db.insert(workspaces).values({ id: WS, name: 'Ledger', createdBy: AGENT, visibility: 'public' });
  await db.insert(metrics).values({
    id: 'metric-ledger',
    workspaceId: WS,
    name: 'Revenue',
    value: 0,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: 'metric-ledger',
    metricName: 'Revenue',
    targetDate: '2028',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 100,
    pool: initialPool(100),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
  await db.insert(trades).values({
    id: 'trade-1',
    workspaceId: WS,
    agentId: AGENT,
    marketId: MARKET,
    direction: 'higher',
    shares: 10,
    cost: 5,
    createdAt: new Date(),
  });
  await db.insert(liquidityEvents).values({
    id: 'liq-1',
    workspaceId: WS,
    marketId: MARKET,
    agentId: AGENT,
    amount: 100,
    totalLiquidity: 100,
    type: 'initial',
    createdAt: new Date(),
  });
}

describe('trades', () => {
  test('a trade can be written', async () => {
    await seed();
    await db.insert(trades).values({
      id: 'trade-2',
      workspaceId: WS,
      agentId: AGENT,
      marketId: MARKET,
      direction: 'lower',
      shares: 3,
      cost: 2,
      createdAt: new Date(),
    });
    expect(await db.select().from(trades)).toHaveLength(2);
  });

  test('a trade cannot be edited', async () => {
    await seed();
    expect(await refusal(db.update(trades).set({ cost: 999 }).where(eq(trades.id, 'trade-1')))).toMatch(/append-only/i);
    const [row] = await db.select().from(trades).where(eq(trades.id, 'trade-1'));
    expect(row.cost).toBe(5);
  });

  test('a trade cannot be deleted, which is the production incident', async () => {
    await seed();
    expect(await refusal(db.delete(trades).where(eq(trades.id, 'trade-1')))).toMatch(/append-only/i);
    expect(await db.select().from(trades)).toHaveLength(1);
  });

  test('a blanket delete cannot quietly empty the table either', async () => {
    await seed();
    expect(await refusal(db.delete(trades))).toMatch(/append-only/i);
    expect(await db.select().from(trades)).toHaveLength(1);
  });
});

describe('liquidity events', () => {
  test('an injection can be written', async () => {
    await seed();
    await db.insert(liquidityEvents).values({
      id: 'liq-2',
      workspaceId: WS,
      marketId: MARKET,
      agentId: AGENT,
      amount: 50,
      totalLiquidity: 150,
      type: 'agent',
      createdAt: new Date(),
    });
    expect(await db.select().from(liquidityEvents)).toHaveLength(2);
  });

  test('an injection cannot be edited or deleted', async () => {
    await seed();
    expect(await refusal(db.update(liquidityEvents).set({ amount: 1 }).where(eq(liquidityEvents.id, 'liq-1')))).toMatch(
      /append-only/i,
    );
    expect(await refusal(db.delete(liquidityEvents).where(eq(liquidityEvents.id, 'liq-1')))).toMatch(/append-only/i);
    const [row] = await db.select().from(liquidityEvents);
    expect(row.amount).toBe(100);
  });
});

describe('the sanctioned escape hatch', () => {
  test('a transaction that opts in may remove history', async () => {
    await seed();
    await db.transaction(async tx => {
      await allowLedgerAdmin(tx);
      await tx.delete(trades).where(eq(trades.workspaceId, WS));
      await tx.delete(liquidityEvents).where(eq(liquidityEvents.workspaceId, WS));
    });
    expect(await db.select().from(trades)).toHaveLength(0);
    expect(await db.select().from(liquidityEvents)).toHaveLength(0);
  });

  test('opting in does not leak past its transaction', async () => {
    await seed();
    await db.transaction(async tx => {
      await allowLedgerAdmin(tx);
      await tx.delete(liquidityEvents).where(eq(liquidityEvents.id, 'liq-1'));
    });
    // The next statement, on the same pooled connection, is locked again.
    expect(await refusal(db.delete(trades).where(eq(trades.id, 'trade-1')))).toMatch(/append-only/i);
    expect(await db.select().from(trades)).toHaveLength(1);
  });

  test('a transaction that does NOT opt in is refused even inside a transaction', async () => {
    await seed();
    expect(
      await refusal(
        db.transaction(async tx => {
          await tx.delete(trades).where(eq(trades.id, 'trade-1'));
        }),
      ),
    ).toMatch(/append-only/i);
    expect(await db.select().from(trades)).toHaveLength(1);
  });

  test('the refusal names the table and the operation', async () => {
    await seed();
    expect(await refusal(db.delete(trades))).toMatch(/trades/);
    expect(await refusal(db.update(liquidityEvents).set({ amount: 2 }))).toMatch(/liquidity_events/);
  });
});

describe('what the ledgers are for', () => {
  test('history is superseded by another row, not by an edit', async () => {
    await seed();
    // The way to correct a position is another trade, which is what the
    // append-only rule is pushing every caller toward.
    await db.insert(trades).values({
      id: 'trade-unwind',
      workspaceId: WS,
      agentId: AGENT,
      marketId: MARKET,
      direction: 'higher',
      shares: -10,
      cost: -5,
      createdAt: new Date(),
    });
    const rows = await db.select().from(trades).where(eq(trades.agentId, AGENT));
    expect(rows).toHaveLength(2);
    expect(rows.reduce((sum, r) => sum + r.cost, 0)).toBe(0);
  });

  test('the trigger is on the table, not on the application', async () => {
    await seed();
    // Raw SQL, no Drizzle, no route: the same refusal. This is the property
    // that makes a psql session as constrained as the app.
    expect(await refusal(db.execute(sql`delete from trades`))).toMatch(/append-only/i);
  });
});

/**
 * The two records added on 2026-08-18 carry the same guarantee, for the same
 * reason: `credit_ledger` is what makes a balance reconstructible, and
 * `metric_definition_revisions` is the only thing standing between "the owner
 * clarified the wording" and "the owner moved the goalposts and nobody can
 * tell". An editable audit log is not an audit log.
 */
describe('the credit ledger and the revision log are append-only too', () => {
  const ledgerRow = {
    id: 'cl-1',
    workspaceId: WS,
    agentId: AGENT,
    deltaUnits: 1_000_000_000,
    balanceAfterUnits: 1_000_000_000,
    reason: 'signup_grant',
    refType: null,
    refId: null,
  };
  const revisionRow = {
    id: 'rev-1',
    workspaceId: WS,
    metricId: 'metric-1',
    field: 'description',
    oldValue: 'before',
    newValue: 'after',
    changedBy: AGENT,
  };

  test('a credit ledger row cannot be edited or deleted', async () => {
    await seed();
    await db.insert(creditLedger).values(ledgerRow);

    expect(await refusal(db.update(creditLedger).set({ deltaUnits: 5 }))).toMatch(/append-only/i);
    expect(await refusal(db.delete(creditLedger))).toMatch(/credit_ledger/);
    expect(await db.select().from(creditLedger)).toHaveLength(1);
  });

  test('a definition revision cannot be edited or deleted', async () => {
    await seed();
    await db.insert(metricDefinitionRevisions).values(revisionRow);

    expect(await refusal(db.update(metricDefinitionRevisions).set({ newValue: 'rewritten' }))).toMatch(/append-only/i);
    expect(await refusal(db.delete(metricDefinitionRevisions))).toMatch(/metric_definition_revisions/);
    expect(await db.select().from(metricDefinitionRevisions)).toHaveLength(1);
  });

  test('raw SQL is refused the same way', async () => {
    await seed();
    await db.insert(creditLedger).values(ledgerRow);
    expect(await refusal(db.execute(sql`update credit_ledger set delta_units = 0`))).toMatch(/append-only/i);
  });

  test('the sanctioned path can still cascade', async () => {
    await seed();
    await db.insert(creditLedger).values(ledgerRow);
    // Deleting a participant genuinely removes their history; the opt-in is
    // per transaction, so an ad-hoc psql session cannot do it by accident.
    await db.transaction(async tx => {
      await allowLedgerAdmin(tx);
      await tx.delete(creditLedger).where(eq(creditLedger.agentId, AGENT));
    });
    expect(await db.select().from(creditLedger)).toHaveLength(0);
  });
});

/**
 * `proposal_revisions` is the proposal-side twin of the metric revision log:
 * a proposal's title, description and ask edit in place, and the revision row
 * is the only thing that shows a holder the goalposts moved after they took
 * a position (docs/market-integrity.md, "Words are edited in place, and
 * published"). Created in 0066 with the same shape but, until 0080, without
 * the trigger; the first conformance audit (2026-08-25) found the gap.
 */
describe('the proposal revision log is append-only', () => {
  const revisionRow = {
    id: 'prev-1',
    workspaceId: WS,
    proposalId: 'proposal-1',
    field: 'askUsd',
    oldValue: '100',
    newValue: '150',
    changedBy: AGENT,
  };

  test('a proposal revision can be written', async () => {
    await seed();
    await db.insert(proposalRevisions).values(revisionRow);
    expect(await db.select().from(proposalRevisions)).toHaveLength(1);
  });

  test('a proposal revision cannot be edited or deleted', async () => {
    await seed();
    await db.insert(proposalRevisions).values(revisionRow);

    expect(await refusal(db.update(proposalRevisions).set({ newValue: '100' }))).toMatch(/append-only/i);
    expect(await refusal(db.delete(proposalRevisions))).toMatch(/proposal_revisions/);
    const [row] = await db.select().from(proposalRevisions);
    expect(row.newValue).toBe('150');
  });

  test('raw SQL is refused the same way', async () => {
    await seed();
    await db.insert(proposalRevisions).values(revisionRow);
    expect(await refusal(db.execute(sql`delete from proposal_revisions`))).toMatch(/append-only/i);
    expect(await db.select().from(proposalRevisions)).toHaveLength(1);
  });

  test('the sanctioned path can still cascade', async () => {
    await seed();
    await db.insert(proposalRevisions).values(revisionRow);
    await db.transaction(async tx => {
      await allowLedgerAdmin(tx);
      await tx.delete(proposalRevisions).where(eq(proposalRevisions.workspaceId, WS));
    });
    expect(await db.select().from(proposalRevisions)).toHaveLength(0);
  });
});
