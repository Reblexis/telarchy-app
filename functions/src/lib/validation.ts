/**
 * Shared input validation helpers.
 * Each returns undefined on success, or an error message string on failure.
 */

/** Agent IDs: alphanumeric, hyphens, underscores. 1–64 chars. */
export function validateAgentId(id: unknown): string | undefined {
  if (typeof id !== 'string') return 'agentId must be a string';
  if (id.length < 1 || id.length > 64) return 'agentId must be 1–64 characters';
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return 'agentId must contain only letters, numbers, hyphens, and underscores';
  return undefined;
}

/** Free-text content fields (task descriptions, messages, metric descriptions). Max 10,000 chars. */
export function validateContent(value: unknown, fieldName = 'content', maxLength = 10_000): string | undefined {
  if (typeof value !== 'string') return `${fieldName} must be a string`;
  if (value.length > maxLength) return `${fieldName} must be at most ${maxLength} characters`;
  return undefined;
}

/** On-chain transaction hashes: 0x followed by 64 hex characters. */
export function validateTxHash(hash: unknown): string | undefined {
  if (typeof hash !== 'string') return 'txHash must be a string';
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) return 'txHash must be a 0x-prefixed 64-character hex string';
  return undefined;
}

/**
 * Precision for balance storage: 1 credit = 1,000,000,000 units (nanocredits).
 * Storing balances as integers (like Bitcoin stores satoshis) eliminates all
 * IEEE 754 floating-point drift. Maximum rounding per operation: 0.0000000005 credits.
 *
 * Constraint: stored integers must stay within Number.MAX_SAFE_INTEGER (~9.007e15),
 * so the maximum balance is MAX_SAFE_INTEGER / CREDIT_PRECISION ≈ 9,007,199 credits.
 *
 * Rule: balances in Firestore are always stored as integer units (nanocredits).
 *       All FieldValue.increment() calls on balance use toUnits(delta).
 *       All balance reads from Firestore go through fromUnits() before use.
 */
export const CREDIT_PRECISION = 1_000_000_000;

/** Credits granted to every new participant (human or agent) on signup. */
export const SIGNUP_CREDITS = 1000;

/** Default liquidity (in credits) auto-funded per new market on workspace creation. */
export const DEFAULT_MARKET_LIQUIDITY_CREDITS = 0.5;

/** Convert decimal credits → integer nanocredits for Firestore storage. */
export function toUnits(credits: number): number {
  return Math.round(credits * CREDIT_PRECISION);
}

/** Convert integer nanocredits (stored in Firestore) → decimal credits for display/computation. */
export function fromUnits(units: number): number {
  return units / CREDIT_PRECISION;
}

/**
 * Check whether a stored balance (in nanocredits) covers a required cost (in decimal credits).
 * Comparison is integer vs integer — no float drift possible.
 */
export function sufficientBalance(balanceUnits: number, cost: number): boolean {
  return balanceUnits >= toUnits(cost);
}
