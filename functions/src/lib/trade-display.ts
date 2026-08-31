/**
 * Turning ledger rows into the rows a person reads.
 *
 * `trades` is a ledger: it carries everything the price replay needs, which
 * includes the two rows a matched-pair redemption writes (one per side, same
 * instant). Those rows are not something the trader did. Rendering them by
 * the sign of their cost, as every list here used to, showed one buy as three
 * trades, two of them sells the trader never placed.
 *
 * So a display list is built from the ledger rather than being it:
 *
 * - a tape of trades against the market omits redemptions entirely
 *   (`isRedemption`), because nothing was traded and no price moved;
 * - a participant's own history keeps them, collapsed to ONE row per
 *   redemption (`collapseRedemptions`), because their balance moved and the
 *   record has to explain that.
 */

/** A ledger row, as far as display cares. */
export interface LedgerTradeRow {
  id: string;
  agentId: string;
  marketId: string;
  direction: string;
  /** Negative for sells and for both sides of a redemption. */
  shares: number;
  /** Negative for credits paid out. */
  cost: number;
  kind: string;
  createdAt: Date;
}

/** What a display row says happened. */
export type DisplayKind = 'buy' | 'sell' | 'redeem';

export function isRedemption(row: { kind: string }): boolean {
  return row.kind === 'redeem';
}

/** buy / sell for real trades; the sign of `shares` is what separates them. */
export function displayKind(row: { kind: string; shares: number }): DisplayKind {
  if (isRedemption(row)) return 'redeem';
  return row.shares < 0 ? 'sell' : 'buy';
}

export interface DisplayTradeRow<T> {
  /** The ledger row this display row leads with (the pair's first side). */
  row: T;
  kind: DisplayKind;
  /** Always positive: shares bought, sold, or redeemed as matched pairs. */
  shares: number;
  /** Always positive: credits paid for a buy, received for a sell or a
   *  redemption. A redemption's two sides are summed, so this is the whole
   *  1 credit per pair rather than one side's share of it. */
  cost: number;
}

/**
 * Collapse each redemption's two rows into one display row, leaving every
 * other row alone and preserving the order it was given in.
 *
 * A pair is identified the way the writer creates it: same participant, same
 * market, same instant, both marked `redeem`. Sides are summed rather than
 * doubled - the two rows carry `-pairs` shares each and split one credit per
 * pair between them, so the pair's shares are one side's and its credits are
 * both sides added up.
 */
export function collapseRedemptions<T extends LedgerTradeRow>(rows: T[]): DisplayTradeRow<T>[] {
  const out: DisplayTradeRow<T>[] = [];
  const seen = new Map<string, DisplayTradeRow<T>>();
  for (const row of rows) {
    if (!isRedemption(row)) {
      out.push({ row, kind: displayKind(row), shares: Math.abs(row.shares), cost: Math.abs(row.cost) });
      continue;
    }
    const key = `${row.agentId}|${row.marketId}|${row.createdAt.getTime()}`;
    const existing = seen.get(key);
    if (existing) {
      // The second side of a pair already shown: add its credits, keep the
      // shares (both sides carry the same count, and a pair is one thing).
      existing.cost += Math.abs(row.cost);
      continue;
    }
    const display: DisplayTradeRow<T> = {
      row,
      kind: 'redeem',
      shares: Math.abs(row.shares),
      cost: Math.abs(row.cost),
    };
    seen.set(key, display);
    out.push(display);
  }
  return out;
}
