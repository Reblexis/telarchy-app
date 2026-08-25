/**
 * The only door to `agents.balance`.
 *
 * Every credit that moves leaves a row in `credit_ledger`, in the same
 * transaction as the balance change, so a balance change without a record is
 * not expressible. `agents.balance` becomes a cache of this ledger's sum,
 * and `credit-ledger-reconciliation.test.ts` proves the two agree.
 *
 * Before this existed, about twenty-five call sites incremented the balance
 * column directly with raw SQL and left nothing behind: a wrong balance could
 * not be explained, and a lost one could not be rebuilt. `trades` and
 * `liquidity_events` were append-only and protected, but they are two of a
 * dozen ways money moves; payouts, void refunds, proposal stakes and rewards,
 * spam penalties, contract payments, signup grants, limit-order holds and
 * admin adjustments were all invisible.
 *
 * `credit-ledger-ownership.test.ts` greps the backend and fails if any file
 * other than this one writes `agents.balance`. That test is what keeps the
 * ledger complete as new code is written; a partial ledger is worse than none,
 * because it reads as complete.
 *
 * Governing doc: docs/market-integrity.md.
 */

import { randomUUID } from 'crypto';
import { and, eq, gte, type SQL, sql } from 'drizzle-orm';
import type { db } from '../db/client';
import { agents, creditLedger } from '../db/schema';

type DbOrTx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/**
 * Why credits moved. A closed set on purpose: an open string field turns into
 * twenty spellings of "payout" and the ledger stops being queryable.
 */
export type CreditReason =
  | 'trade' // buying or selling shares (cost debited, proceeds credited)
  | 'payout' // a resolved market paying its holders
  | 'void_refund' // a voided market returning net cash
  | 'lp_leftover' // pool left over after a void, back to its funders
  | 'liquidity' // funding a market's pool
  | 'proposal_stake' // the stake a proposal costs to post
  | 'proposal_reward' // the reward an approved proposal pays
  | 'proposal_penalty' // the spam penalty a removed proposal charges
  | 'contract_payment' // a job's agreed price, paid on approval
  | 'signup_grant' // the platform's starting balance
  | 'limit_order_hold' // budget reserved when a resting order is placed
  | 'limit_order_release' // the unfilled remainder returned
  | 'transfer_in'
  | 'transfer_out'
  | 'admin_adjustment' // an operator setting a balance by hand
  | 'opening_balance'; // migration 0060: the balance that predates the ledger

/** What caused the movement, so a row can be traced back to its cause. */
export type CreditRefType = 'market' | 'proposal' | 'transfer' | 'season' | null;

/**
 * The workspace id used for movements that are not scoped to one workspace:
 * signup grants, transfers between participants, admin adjustments. A real id
 * would be a lie, and null would make the composite primary key useless.
 */
export const PLATFORM_SCOPE = 'platform';

export interface ApplyCreditsParams {
  agentId: string;
  /** The workspace whose activity moved the money, or PLATFORM_SCOPE. */
  workspaceId: string;
  /** Signed nanocredits. Negative is a debit. */
  deltaUnits: number;
  reason: CreditReason;
  refType?: CreditRefType;
  refId?: string | null;
  /**
   * Sibling counters to update in the same statement. They are display
   * aggregates, not money, but they have to move atomically with the balance
   * or a crash between two statements leaves a participant's stats
   * disagreeing with their balance forever.
   *
   * Closed shape rather than Record<string, ...>: a spread of arbitrary keys
   * into `.set()` bypasses Drizzle's column typing, so a typo'd key compiles
   * and silently updates nothing.
   */
  also?: {
    earnedBetting?: SQL;
    spentBetting?: SQL;
    spentTokens?: SQL;
  };
}

/**
 * Move credits and record why. Returns the balance the row produced.
 *
 * Does NOT check sufficiency: callers know their own rules (a trade refuses
 * at a different threshold than a proposal stake, and a refund has no floor at
 * all), and a check here would be a second, weaker copy of theirs.
 */
export async function applyCredits(tx: DbOrTx, params: ApplyCreditsParams): Promise<{ balanceAfterUnits: number }> {
  const result = await applyCreditsIfSufficient(tx, params);
  // A delta against a participant who does not exist is a bug in the caller,
  // not something to paper over: the money went nowhere and the ledger would
  // claim otherwise.
  if (!result) throw new Error(`applyCredits: no participant ${params.agentId} (reason ${params.reason})`);
  return result;
}

/**
 * The same movement, but conditional on the balance covering it.
 *
 * Returns null instead of applying when `minBalanceUnits` is set and the
 * balance is below it, so a caller can use the debit itself as its balance
 * check with no read-then-write race (the transfer endpoint does exactly
 * this). Also returns null when the participant does not exist.
 */
export async function applyCreditsIfSufficient(
  tx: DbOrTx,
  params: ApplyCreditsParams & { minBalanceUnits?: number },
): Promise<{ balanceAfterUnits: number } | null> {
  const { agentId, workspaceId, deltaUnits, reason, refType = null, refId = null, also, minBalanceUnits } = params;

  const where =
    minBalanceUnits === undefined
      ? eq(agents.id, agentId)
      : and(eq(agents.id, agentId), gte(agents.balance, minBalanceUnits));

  const [row] = await tx
    .update(agents)
    .set({ balance: sql`${agents.balance} + ${deltaUnits}`, ...(also ?? {}) })
    .where(where)
    .returning({ balance: agents.balance });

  if (!row) return null;

  const balanceAfterUnits = Number(row.balance);

  await tx.insert(creditLedger).values({
    id: randomUUID(),
    workspaceId,
    agentId,
    deltaUnits,
    balanceAfterUnits,
    reason,
    refType,
    refId,
  });

  return { balanceAfterUnits };
}
