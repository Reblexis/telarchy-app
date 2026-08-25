import { type SQL, sql } from 'drizzle-orm';

/**
 * Just the one capability this needs: issue a statement inside the caller's
 * transaction. Typed structurally rather than against the node-pg
 * transaction, so the pglite-backed test harness satisfies it too.
 */
type Executor = { execute: (query: SQL) => Promise<unknown> };

/**
 * Unlock the append-only ledgers for the rest of THIS transaction.
 *
 * `trades` and `liquidity_events` refuse UPDATE and DELETE by database
 * trigger (migration 0055), because they are the record a market settles on:
 * every price, payout and refund is derived from them, so an edit rewrites
 * history that nothing in the app would notice. A stray production DELETE on
 * 2026-08-15 is why the trigger exists.
 *
 * A few operations legitimately remove that history: deleting a workspace or
 * a participant, resetting a workspace, and re-attributing an LP row to the
 * account that actually funded it. They call this first, so the intent is
 * written at the call site rather than assumed. The setting is
 * transaction-local (`set_config(..., true)`), so it cannot leak into the
 * next statement on a pooled connection.
 *
 * If you are reaching for this in new code, the question to answer first is
 * why the history should disappear rather than be superseded by another row.
 */
export async function allowLedgerAdmin(tx: Executor): Promise<void> {
  await tx.execute(sql`select set_config('telarchy.ledger_admin', 'on', true)`);
}
