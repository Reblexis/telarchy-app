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

/**
 * Optional participant nickname: 3–30 chars, alphanumeric + hyphens + underscores,
 * must start with a letter or digit. Case-insensitive uniqueness is enforced at
 * the database layer (partial unique index on LOWER(nickname)).
 */
export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 30;
const NICKNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function validateNickname(value: unknown): string | undefined {
  if (typeof value !== 'string') return 'nickname must be a string';
  if (value.length < NICKNAME_MIN || value.length > NICKNAME_MAX) {
    return `nickname must be ${NICKNAME_MIN}–${NICKNAME_MAX} characters`;
  }
  if (!NICKNAME_RE.test(value)) {
    return 'nickname must start with a letter or digit and contain only letters, digits, hyphens, and underscores';
  }
  return undefined;
}

/** Free-text content fields (proposal descriptions, messages, metric descriptions). Max 10,000 chars. */
export function validateContent(value: unknown, fieldName = 'content', maxLength = 10_000): string | undefined {
  if (typeof value !== 'string') return `${fieldName} must be a string`;
  if (value.length > maxLength) return `${fieldName} must be at most ${maxLength} characters`;
  return undefined;
}

const VISIBILITY_VALUES = ['public', 'unlisted', 'private'] as const;
export type WorkspaceVisibilityInput = (typeof VISIBILITY_VALUES)[number];

export function parseVisibility(value: unknown): { ok: true; value: WorkspaceVisibilityInput } | { ok: false; error: string } {
  if (typeof value !== 'string' || !(VISIBILITY_VALUES as readonly string[]).includes(value)) {
    return { ok: false, error: `visibility must be one of: ${VISIBILITY_VALUES.join(', ')}` };
  }
  return { ok: true, value: value as WorkspaceVisibilityInput };
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

/**
 * Minimum credits for a single liquidity injection. Below this, the LMSR b
 * parameter is so small that any trade (even a sub-cent one) swings consensus
 * by hundreds of points, producing butterfly-sensitive markets. Any attempt to
 * inject less is rejected to prevent that failure mode.
 */
export const MIN_LIQUIDITY_CONTRIBUTION = 0.1;

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
