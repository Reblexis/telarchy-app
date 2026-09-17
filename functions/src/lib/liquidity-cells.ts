import { MIN_LIQUIDITY_CONTRIBUTION } from './validation';

/** One book a contributor funds: `amount` credits into EACH branch book of
 *  this metric and date (docs/guides/get-paid.md, "Posting one"). */
export interface LiquidityCell {
  metricId: string;
  targetDate: string;
  amount: number;
}

export const MAX_LIQUIDITY_CELLS = 500;

export const cellKey = (c: { metricId: string; targetDate: string }) => `${c.metricId}:${c.targetDate}`;

/**
 * Reads a request's `liquidity` list. Zero amounts are dropped (a cell left
 * at 0 on a form is no seed); anything malformed is an error in words, never
 * a guess. Pure, so the two routes that take the list cannot disagree.
 */
export function parseLiquidityCells(raw: unknown): { cells: LiquidityCell[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'liquidity must be a list of { metricId, targetDate, amount }' };
  if (raw.length > MAX_LIQUIDITY_CELLS) return { error: `liquidity takes at most ${MAX_LIQUIDITY_CELLS} entries` };
  const seen = new Set<string>();
  const cells: LiquidityCell[] = [];
  for (const entry of raw) {
    const e = entry as Partial<LiquidityCell> | null;
    if (!e || typeof e.metricId !== 'string' || !e.metricId || typeof e.targetDate !== 'string' || !e.targetDate) {
      return { error: 'every liquidity entry needs a metricId and a targetDate' };
    }
    if (typeof e.amount !== 'number' || !Number.isFinite(e.amount) || e.amount < 0) {
      return { error: `liquidity amount for ${e.metricId} ${e.targetDate} must be a non-negative number` };
    }
    const key = cellKey(e as LiquidityCell);
    if (seen.has(key)) return { error: `liquidity names ${e.metricId} ${e.targetDate} twice` };
    seen.add(key);
    if (e.amount === 0) continue;
    if (e.amount < MIN_LIQUIDITY_CONTRIBUTION) {
      return { error: `liquidity amount must be at least ${MIN_LIQUIDITY_CONTRIBUTION} credits per book when set` };
    }
    cells.push({ metricId: e.metricId, targetDate: e.targetDate, amount: e.amount });
  }
  return { cells };
}
