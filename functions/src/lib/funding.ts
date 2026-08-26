/**
 * Funding packages and workspace pool months: the pure arithmetic behind
 * docs/liquidity.md and docs/workspace-pools.md. No database, no clock of
 * its own; every function takes its instant as an argument so the rules can
 * be tested with arithmetic alone.
 */

import { CREDIT_PRECISION } from './validation';

/** Credits per dollar of a funding package (decision 2026-08-26, Viktor). */
export const CREDITS_PER_USD = 1000;
/** Share of a package that becomes the cash pool, in basis points (80%). */
export const POOL_FRACTION_BP = 8000;
/** Below this accrued total no transfer is made; the amount waits, it is never lost. */
export const MIN_PAYOUT_CENTS = 500;
/** The processor's floor; the product sets no minimum of its own. */
export const MIN_PURCHASE_CENTS = 100;
export const MAX_PURCHASE_CENTS = 99_999_900;
/** One rung above this is clipped until withholding is set up (CZK 50,000, ~$2,100). */
export const MAX_SINGLE_TRANSFER_CENTS = 210_000;

/** How one payment splits, at the rates in force. */
export function splitPurchase(amountCents: number): { creditsUnits: number; poolCents: number } {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('amountCents must be a positive integer');
  // 1,000 credits per dollar = 10 credits per cent, in nanocredits.
  const creditsUnits = amountCents * (CREDITS_PER_USD / 100) * CREDIT_PRECISION;
  const poolCents = Math.floor((amountCents * POOL_FRACTION_BP) / 10_000);
  return { creditsUnits, poolCents };
}

/** 'YYYY-MM' of an instant, UTC. */
export function monthKey(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function parseMonthKey(key: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** [start, end) of a month key, UTC. */
export function monthBounds(key: string): { start: Date; end: Date } {
  const parsed = parseMonthKey(key);
  if (!parsed) throw new Error(`bad month key ${key}`);
  const start = new Date(Date.UTC(parsed.year, parsed.month - 1, 1));
  const end = new Date(Date.UTC(parsed.year, parsed.month, 1));
  return { start, end };
}

export function nextMonthKey(key: string): string {
  const { end } = monthBounds(key);
  return monthKey(end);
}

/**
 * Which month a package bought at `at` sponsors: the next calendar month.
 * A month's pool is fixed the instant it starts, so a purchase can never
 * change the month that is running (docs/workspace-pools.md, Period and
 * pool).
 */
export function assignPoolMonth(at: Date): string {
  return nextMonthKey(monthKey(at));
}

/** The final week of a month, for the activity floor's "3 trades before". */
export function finalWeekStart(key: string): Date {
  const { end } = monthBounds(key);
  return new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
}
