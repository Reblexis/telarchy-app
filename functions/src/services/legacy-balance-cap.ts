/**
 * Trim balances back to what the earn table pays today
 * (docs/guides/credits.md, "A price cut applies to what was already
 * granted"; owner ask 2026-09-08, "can you cap it at 10k credits for all
 * of them").
 *
 * WHY THIS EXISTS: grant prices are edited as the operator learns what a
 * signal is worth (services/earnRules.ts), and they fall as well as rise.
 * `manifold_link` paid 100,000 credits in August and pays 5,000 now; the
 * 2026-08-28 top-up put every account that existed then on 10,000 where a
 * signup pays 100. Bankroll converts one-for-one into season score, which
 * converts into prize money, so an account funded under an older, higher
 * price is not a historical curiosity: it is a standing head start over
 * everyone who arrived after the cut. Trimming it is what makes "two
 * people who did the same thing hold the same credits" true whichever
 * week they did it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it never credits. An account below the
 * cap is left alone rather than topped up, because paying a grant is the
 * earn table's job and a repair that can also hand out money is a faucet.
 * It never touches `liquidity_balance`, which is walled and cannot be
 * traded. And it never touches a house account by the cap, because
 * adminbot's balance is the float that pays proposal rewards and
 * auto-funds stakes; capping it stops the floor. A house row can still be
 * named in `zeroIds`, which is the escape hatch for a broken row rather
 * than a fairness measure.
 *
 * Record: telarchy umbrella, notes/legacy-balances-2026-09-08.md.
 */

import { and, eq, gt, inArray, notInArray } from 'drizzle-orm';
import { db } from '../db/client';
import { agents } from '../db/schema';
import { toUnits } from '../lib/validation';
import { applyCredits, PLATFORM_SCOPE } from './credits';

export interface BalanceTrim {
  agentId: string;
  beforeUnits: number;
  afterUnits: number;
  deltaUnits: number;
}

export interface CapOptions {
  /** The ceiling, in credits. Every non-exempt participant above it lands
   *  exactly here. */
  capCredits: number;
  /** Goes in the ledger row, so the trim can always be explained later. */
  refId: string;
  /** Taken to zero instead of the cap, house flags ignored: a row that is
   *  not a participant at all (the 0060 backfill artifact). */
  zeroIds?: string[];
  /** Never touched by the cap. */
  exemptIds?: string[];
  /** False (the default) plans without writing. */
  apply?: boolean;
}

/**
 * Plan, and optionally apply, the trim. The plan a dry run returns is the
 * same list an apply returns, so "show me first" is not a different code
 * path from "do it".
 *
 * Idempotent by construction: the selection asks for balances ABOVE the
 * cap, and a trimmed balance is exactly at it.
 */
export async function capLegacyBalances(opts: CapOptions): Promise<BalanceTrim[]> {
  const { capCredits, refId, zeroIds = [], exemptIds = [], apply = false } = opts;

  if (!Number.isFinite(capCredits) || capCredits <= 0) {
    throw new Error(`capLegacyBalances: capCredits must be a positive number, got ${capCredits}`);
  }
  if (!refId.trim()) {
    throw new Error('capLegacyBalances: refId is required, so no trim lands without a reason in the ledger');
  }

  const capUnits = toUnits(capCredits);
  const zeroSet = new Set(zeroIds);

  // Named rows first, at any balance and whatever their flags say.
  const zeroRows = zeroIds.length
    ? await db
        .select({ id: agents.id, balance: agents.balance })
        .from(agents)
        .where(and(inArray(agents.id, zeroIds), gt(agents.balance, 0)))
    : [];

  // Then everyone over the cap who is a participant: not the house, not
  // exempt, and not already handled as a broken row.
  const skip = [...new Set([...exemptIds, ...zeroIds])];
  const cappedRows = await db
    .select({ id: agents.id, balance: agents.balance })
    .from(agents)
    .where(
      and(
        gt(agents.balance, capUnits),
        eq(agents.platformOperated, false),
        eq(agents.platformAdmin, false),
        ...(skip.length ? [notInArray(agents.id, skip)] : []),
      ),
    );

  const trims: BalanceTrim[] = [...zeroRows, ...cappedRows]
    .map(r => {
      const beforeUnits = Number(r.balance);
      const afterUnits = zeroSet.has(r.id) ? 0 : capUnits;
      return { agentId: r.id, beforeUnits, afterUnits, deltaUnits: afterUnits - beforeUnits };
    })
    // No filter for "is this a debit?": the two selections above ask for a
    // balance ABOVE the cap and a named row ABOVE zero, so every delta is
    // strictly negative by construction. Adding a guard here would be a
    // branch no test could reach, which reads as protection and is not.
    .sort((a, b) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0));

  if (!apply || trims.length === 0) return trims;

  // One transaction: a half-applied fairness measure is worse than none,
  // because the half that landed cannot be explained by the rule.
  await db.transaction(async tx => {
    for (const t of trims) {
      // Conditioned on the balance still being what was planned, so a trade
      // that lands between the plan and the write cannot be silently
      // overwritten (and cannot push anyone negative).
      const [row] = await tx
        .select({ balance: agents.balance })
        .from(agents)
        .where(eq(agents.id, t.agentId))
        .for('update');
      if (!row || Number(row.balance) !== t.beforeUnits) {
        throw new Error(
          `capLegacyBalances: ${t.agentId} moved between the plan and the write ` +
            `(${t.beforeUnits} -> ${row ? Number(row.balance) : 'gone'}); re-run the plan`,
        );
      }
      await applyCredits(tx, {
        agentId: t.agentId,
        workspaceId: PLATFORM_SCOPE,
        deltaUnits: t.deltaUnits,
        reason: 'admin_adjustment',
        // `CreditRefType` is a closed set of things a row can POINT AT (a
        // market, a proposal, a transfer, a season) and this points at
        // nothing; the refId carries the reason instead.
        refType: null,
        refId,
      });
    }
  });

  return trims;
}
