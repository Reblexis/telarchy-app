/**
 * Shared input validation helpers.
 * Each returns undefined on success, or an error message string on failure.
 */

/** Agent IDs: alphanumeric, hyphens, underscores. 1-64 chars. */
export function validateAgentId(id: unknown): string | undefined {
  if (typeof id !== 'string') return 'agentId must be a string';
  if (id.length < 1 || id.length > 64) return 'agentId must be 1-64 characters';
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return 'agentId must contain only letters, numbers, hyphens, and underscores';
  return undefined;
}

/**
 * Optional participant nickname: 3-30 chars, alphanumeric + hyphens + underscores,
 * must start with a letter or digit. Case-insensitive uniqueness is enforced at
 * the database layer (partial unique index on LOWER(nickname)).
 */
export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 30;
const NICKNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function validateNickname(value: unknown): string | undefined {
  if (typeof value !== 'string') return 'nickname must be a string';
  if (value.length < NICKNAME_MIN || value.length > NICKNAME_MAX) {
    return `nickname must be ${NICKNAME_MIN}-${NICKNAME_MAX} characters`;
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

export function parseVisibility(
  value: unknown,
): { ok: true; value: WorkspaceVisibilityInput } | { ok: false; error: string } {
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

/**
 * Credits granted to a new USER account (a browser signup: email/password,
 * Google, or GitHub) on signup. Per-instance configuration via the
 * SIGNUP_CREDITS env var; defaults to 10,000 (raised from 1,000 on
 * 2026-08-28: grants are priced at the brought value of a real person
 * arriving, and API registrations now start at zero, so the user grant is
 * the working bankroll; design record in the telarchy umbrella,
 * notes/trader-rewards-design-2026-08-28.md). Instances that issue credits
 * only through admin crediting or transfers set it to 0. An invalid value
 * falls back to the default with a boot warning.
 */
export function parseSignupCredits(raw: string | undefined, fallback = 10000): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isSafeInteger(parsed * CREDIT_PRECISION)) {
    console.warn(`SIGNUP_CREDITS env value ${JSON.stringify(raw)} is invalid; falling back to ${fallback}`);
    return fallback;
  }
  return parsed;
}

export const SIGNUP_CREDITS = parseSignupCredits(process.env.SIGNUP_CREDITS);

/**
 * Credits granted to a participant registered through the API with no
 * browser account (`POST /api/agents/register`, and sub-bots created via
 * `POST /api/agents`). Default 0 since 2026-08-28: an API identity is free
 * to mint, so a grant on it prices the real-money season's cheapest input
 * at the cost of a curl call (the grant-farming vector in the design record
 * above). An agent trades on credits transferred from its owner
 * (`POST /api/agents/transfer`) or granted by a workspace admin
 * (`POST /api/agents/:id/credit`). Env: AGENT_SIGNUP_CREDITS.
 */
export const AGENT_SIGNUP_CREDITS = parseSignupCredits(process.env.AGENT_SIGNUP_CREDITS, 0);

/**
 * Credits granted to a key-first identity created via POST /api/onboard
 * before a human claims it with a browser account. Kept deliberately below
 * SIGNUP_CREDITS so anonymous identity farming is unattractive; the claim
 * step tops the balance up by the difference. Per-instance via the
 * UNCLAIMED_SIGNUP_CREDITS env var; defaults to 100, clamped to
 * SIGNUP_CREDITS.
 */
export const UNCLAIMED_SIGNUP_CREDITS = Math.min(
  parseSignupCredits(process.env.UNCLAIMED_SIGNUP_CREDITS, 100),
  SIGNUP_CREDITS,
);

/** Default liquidity (in credits) auto-funded per new market on workspace creation. */
export const DEFAULT_MARKET_LIQUIDITY_CREDITS = 0.5;

/**
 * No policy minimum on a liquidity injection (operator decision, Viktor
 * 2026-07-13): credits are 1:1 with CC, so an absolute credit floor like 0.1 is
 * arbitrary. The only floor is the storage precision itself - one nanocredit
 * (1e-9 credits) - so an amount cannot round down to zero nanocredits and
 * create a degenerate zero-liquidity market. Anything at or above one
 * nanocredit is allowed; a thin market is the proposer's own risk to take, not
 * something the platform forbids. LMSR stays well-behaved because b and trade
 * sizes scale together in the same credit unit.
 */
export const MIN_LIQUIDITY_CONTRIBUTION = 1e-9;

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
 * Comparison is integer vs integer, no float drift possible.
 */
export function sufficientBalance(balanceUnits: number, cost: number): boolean {
  return balanceUnits >= toUnits(cost);
}

/**
 * What an account can put into a market's POOL, in units: the bought
 * liquidity wallet plus the tradeable balance, because that is the order
 * `applyAgentLiquidityInjectionTx` spends them in (owner decision
 * 2026-08-28, two currencies).
 *
 * Funding decisions have to ask this rather than reading `balance`, or the
 * house sits on a full liquidity wallet while new markets spawn dead for
 * want of tradeable credits (owner report 2026-08-30, after granting the
 * admin account 1,000,000 liquidity credits and finding the gates blind to
 * them).
 */
export function liquiditySpendableUnits(agent: { balance: unknown; liquidityBalance?: unknown }): number {
  const tradeable = typeof agent.balance === 'number' ? agent.balance : 0;
  const wallet = typeof agent.liquidityBalance === 'number' ? agent.liquidityBalance : 0;
  return tradeable + wallet;
}

export const MAX_BIO_LENGTH = 500;

/**
 * Normalize a participant bio input: trim, cap at MAX_BIO_LENGTH, empty
 * string clears (returns null). Returns Error for invalid type or length.
 */
export function normalizeBio(raw: unknown): string | null | Error {
  if (raw === null) return null;
  if (typeof raw !== 'string') return new Error('bio must be a string');
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_BIO_LENGTH) {
    return new Error(`bio must be at most ${MAX_BIO_LENGTH} characters`);
  }
  return trimmed;
}
